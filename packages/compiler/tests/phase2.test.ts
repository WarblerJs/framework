import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { compileProject } from "../src";
import { RouteFlag, SocketFlag } from "../src/flags/flags";
import { createExecutableBindingsRuntime } from "@warblerjs/runtime";

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function phase2Project(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-phase2-"));
  temporaryProjects.push(root);
  const packagesRoot = resolve(import.meta.dir, "..", "..");
  const scope = join(root, "node_modules", "@warblerjs");
  mkdirSync(scope, { recursive: true });
  for (const name of ["config", "console", "core", "http", "i18n", "runtime", "transport", "validators", "websocket"]) {
    symlinkSync(join(packagesRoot, name), join(scope, name));
  }
  const typesScope = join(root, "node_modules", "@types");
  mkdirSync(typesScope, { recursive: true });
  symlinkSync(join(packagesRoot, "runtime", "node_modules", "@types", "bun"), join(typesScope, "bun"));
  await Bun.write(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { lib: ["ESNext"], types: ["bun"], target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, skipLibCheck: true, experimentalDecorators: true, noEmit: true },
    include: ["src/**/*.ts"],
  }));
  await Bun.write(join(root, "src", "application.ts"), `
    import { Graph, Service, ProviderScope, inject } from "@warblerjs/core";
    import { Controller, Get, Post } from "@warblerjs/http";
    import { SocketController, Subscribe, OnOpen } from "@warblerjs/websocket";
    import { defineValidator, v } from "@warblerjs/validators";
    export const ValidateMessage: any = defineValidator({ bodyRules: { value: v.string("invalid_string") } });
    export const ValidateRequest: any = defineValidator({ bodyRules: { value: v.string("invalid_string") } });
    export const AuthGuard = (_request: any, _context: any) => true;
    export const SocketAuthGuard = () => true;
    export const AuditMiddleware = (_request: any, _context: any, next: any) => next();

    @Service({ provide: ProviderScope.ROOT }) export class Logger {}
    @Service() export default class UsersService { readonly logger = inject(Logger); }
    @Controller("/users") export class UsersController {
      @Get("", { validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })
      list() {}
      @Post("", { guards: [AuthGuard] }) create() {}
    }
    @SocketController() export class UsersSocket {
      @OnOpen() open() {}
      @Subscribe("user.changed", { validator: ValidateMessage, guards: [SocketAuthGuard], compression: true, binary: true, rateLimit: { limit: 2, windowMs: 1000 } })
      changed() {}
    }
    @Graph({ prefix: "/api", controllers: [UsersController, UsersSocket], providers: [Logger, UsersService] })
    export class UsersGraph {}
  `);
  return root;
}

describe("Phase 2 optimization", () => {
  test("assigns deterministic IDs and interns every string once", async () => {
    const root = await phase2Project();
    const first = await compileProject(root);
    const second = await compileProject(root);
    const one = first.generatedApplication!;
    const two = second.generatedApplication!;
    expect(one.optimized).toEqual(two.optimized);
    expect(one.files).toEqual(two.files);
    expect(new Set(one.optimized.strings).size).toBe(one.optimized.strings.length);
    expect(one.optimized.strings).toEqual([...one.optimized.strings].sort());
    expect(one.optimized.providers.map((provider) => provider.id)).toEqual([0, 1]);
    expect(one.optimized.routes.map((route) => route.id)).toEqual([0, 1]);
    expect(Object.isFrozen(one.optimized.routes)).toBe(true);
    expect(Object.isFrozen(one.optimized.routes[0])).toBe(true);
  }, 15_000);

  test("generates validator, middleware, guard, dependency, and compact flag tables", async () => {
    const root = await phase2Project();
    const optimized = (await compileProject(root)).generatedApplication!.optimized;
    expect(optimized.validators).toHaveLength(2);
    expect(optimized.middlewares).toHaveLength(1);
    expect(optimized.guards).toHaveLength(2);
    expect(optimized.routeGuards).toEqual([0, 0]);
    expect(optimized.routeMiddleware).toEqual([0]);
    const get = optimized.routes.find((route) => optimized.strings[route.methodId] === "GET")!;
    expect(get.guardCount).toBe(1);
    expect(get.flags & RouteFlag.GET).not.toBe(0);
    expect(get.flags & RouteFlag.VALIDATION).not.toBe(0);
    expect(get.flags & RouteFlag.MIDDLEWARE).not.toBe(0);
    expect(get.flags & RouteFlag.GUARD).not.toBe(0);
    expect(get.flags & RouteFlag.CSRF).not.toBe(0);
    const socket = optimized.socketEvents.find((event) => optimized.strings[event.eventId] === "user.changed")!;
    expect(socket.flags & SocketFlag.VALIDATION).not.toBe(0);
    expect(socket.flags & SocketFlag.GUARD).not.toBe(0);
    expect(socket.flags & SocketFlag.COMPRESSION).not.toBe(0);
    expect(socket.flags & SocketFlag.BINARY).not.toBe(0);
    expect(socket.flags & SocketFlag.RATE_LIMIT).not.toBe(0);
    const loggerId = optimized.providers.find((provider) => optimized.strings[provider.nameId] === "Logger")!.id;
    expect(optimized.providerDependencies).toEqual([loggerId]);
  }, 15_000);

  test("marks declarative handlers that call view helpers as needing view context", async () => {
    const root = await phase2Project();
    await Bun.write(join(root, "src", "application.ts"), `
      import { csrf, defineHttpGraph, view } from "@warblerjs/http";
      import * as handlers from "./handlers";

      export const inline = defineHttpGraph({
        prefix: "/api",
        routes: {
          "GET /": { name: "home", handler: handlers.getHome },
          "GET /csrf": { handler: handlers.getCsrf },
          "GET /inline": { run: () => view("inline") },
          "GET /json": handlers.getJson,
        },
      });
    `);
    await Bun.write(join(root, "src", "handlers.ts"), `
      import { JsonRes, csrf, view } from "@warblerjs/http";

      export const getHome = () => view("index");
      export const getCsrf = () => JsonRes({ token: csrf().token });
      export const getJson = () => JsonRes({ ok: true });
    `);

    const optimized = (await compileProject(root)).generatedApplication!.optimized;
    const route = (path: string) => optimized.routes.find((candidate) => optimized.strings[candidate.pathId] === (path === "/" ? "/api" : `/api${path}`))!;
    expect(route("/").flags & RouteFlag.VIEW_CONTEXT).not.toBe(0);
    expect(route("/csrf").flags & RouteFlag.VIEW_CONTEXT).not.toBe(0);
    expect(route("/inline").flags & RouteFlag.VIEW_CONTEXT).not.toBe(0);
    expect(route("/json").flags & RouteFlag.VIEW_CONTEXT).toBe(0);
  }, 15_000);

  test("normalizes direct function and object handlers in generated bindings", async () => {
    const root = await phase2Project();
    await Bun.write(join(root, "src", "application.ts"), `
      import { createApp } from "@warblerjs/core";
      import { defineHttpGraph } from "@warblerjs/http";
      import * as handlers from "./handlers";
      import { aliasedShow } from "./reexports";

      const http = defineHttpGraph({
        routes: {
          "GET /": { handler: handlers.index, response: "json" },
          "GET /alias/:id": { handler: aliasedShow, response: "json" },
          "GET /object/:id": { handler: handlers.show, response: "json" },
        },
      });

      export default createApp({ graphs: [http] });
    `);
    await Bun.write(join(root, "src", "handlers.ts"), `
      throw new Error("handler module executed during analysis");
      import { JsonRes, type AppRequest } from "@warblerjs/http";
      import { defineValidator, v } from "@warblerjs/validators";

      export const validator = defineValidator({
        paramRules: { id: v.string() },
      });

      export const index = () => JsonRes({ ok: true });
      export const show = {
        validator,
        run(request: AppRequest<typeof validator>) {
          return JsonRes({ id: request.params.id });
        },
      };
    `);
    await Bun.write(join(root, "src", "reexports.ts"), `
      export { show as aliasedShow } from "./handlers";
    `);

    const context = await compileProject(root, { semanticDiagnostics: false });
    expect(context.diagnostics.filter((item) => item.code.startsWith("WARBLER_BINDING"))).toEqual([]);
    const optimized = context.generatedApplication!.optimized;
    expect(optimized.validators).toHaveLength(1);
    const handlers = await Bun.file(join(root, ".warbler", "generated", "handlers.generated.ts")).text();
    expect(handlers).toContain("Object.freeze({ run:");
    expect(handlers).toContain(".run(...input)");
    expect(handlers).not.toContain("typeof Handler0 ===");
    expect(handlers).not.toContain("typeof handler ===");
  }, 15_000);

  test("reports unsupported declarative handler values without executing modules", async () => {
    const root = await phase2Project();
    await Bun.write(join(root, "src", "application.ts"), `
      import { createApp } from "@warblerjs/core";
      import { defineHttpGraph } from "@warblerjs/http";

      const unsupported = 123;
      const http = defineHttpGraph({
        routes: {
          "GET /bad": unsupported,
        },
      });

      export default createApp({ graphs: [http] });
    `);

    const context = await compileProject(root, { semanticDiagnostics: false });
    expect(context.diagnostics).toContainEqual(expect.objectContaining({
      code: "WARBLER1008",
      message: expect.stringContaining("Use either a direct function or an object with a callable run property"),
    }));
    expect(context.generatedApplication?.optimized.routes).toHaveLength(0);
  }, 15_000);

  test("flattens HTTP middleware scopes once in effective route order", async () => {
    const root = await phase2Project();
    const sourcePath = join(root, "src", "application.ts");
    const source = await Bun.file(sourcePath).text();
    await Bun.write(sourcePath, source
      .replace("import { Graph, Service, ProviderScope, inject } from \"@warblerjs/core\";", "import { createApp, Graph, Service, ProviderScope, inject } from \"@warblerjs/core\";")
      .replace("export const AuditMiddleware = (_request: any, _context: any, next: any) => next();", `export const AuditMiddleware = (_request: any, _context: any, next: any) => next();
    export const GraphMiddleware = (_request: any, _context: any, next: any) => next();
    export const ControllerMiddleware = (_request: any, _context: any, next: any) => next();
    export const SharedMiddleware = (_request: any, _context: any, next: any) => next();`)
      .replace("@Controller(\"/users\") export class UsersController", "@Controller({ prefix: \"/users\", middleware: [ControllerMiddleware, SharedMiddleware] }) export class UsersController")
      .replace("providers: [Logger, UsersService] })", "providers: [Logger, UsersService], middleware: [GraphMiddleware] })")
      .replace("export class UsersGraph {}", "export class UsersGraph {}\n    export const app = createApp({ graphs: [UsersGraph] });"));
    const optimized = (await compileProject(root)).generatedApplication!.optimized;
    const name = (id: number): string => optimized.strings[optimized.middlewares[id]!.nameId]!;
    const routeName = (route: typeof optimized.routes[number]): string => optimized.strings[route.methodId]!;
    const get = optimized.routes.find((route) => routeName(route) === "GET")!;
    expect(optimized.routeMiddleware.slice(get.middlewareStart, get.middlewareStart + get.middlewareCount).map(name)).toEqual([
      "GraphMiddleware",
      "ControllerMiddleware",
      "SharedMiddleware",
      "AuditMiddleware",
    ]);
    const post = optimized.routes.find((route) => routeName(route) === "POST")!;
    expect(optimized.routeMiddleware.slice(post.middlewareStart, post.middlewareStart + post.middlewareCount).map(name)).toEqual([
      "GraphMiddleware",
      "ControllerMiddleware",
      "SharedMiddleware",
    ]);
    expect(optimized.socketMiddleware).toEqual([]);
  }, 15_000);

  test("keeps existing IDs consistent when a deterministically later route is added", async () => {
    const root = await phase2Project();
    const first = (await compileProject(root)).generatedApplication!.optimized;
    const before = first.routes.find((route) => first.strings[route.methodId] === "GET")!.id;
    const sourcePath = join(root, "src", "application.ts");
    const source = await Bun.file(sourcePath).text();
    await Bun.write(sourcePath, source.replace("@Post(\"\",", "@Post(\"/zzz\","));
    const second = (await compileProject(root)).generatedApplication!.optimized;
    const after = second.routes.find((route) => second.strings[route.methodId] === "GET")!.id;
    expect(after).toBe(before);
  }, 15_000);
});

describe("Phase 2 generated artifacts", () => {
  test("writes all artifacts and generated TypeScript compiles", async () => {
    const root = await phase2Project();
    await compileProject(root);
    const names = [
      "routes.generated.ts", "socket.generated.ts", "providers.generated.ts",
      "tables.generated.ts", "application.generated.ts",
    ];
    for (const name of names) expect(await Bun.file(join(root, ".warbler", "generated", name)).exists()).toBe(true);
    const program = ts.createProgram({
      rootNames: names.map((name) => join(root, ".warbler", "generated", name)),
      options: { strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler },
    });
    const generatedDiagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.file?.fileName.includes("/.warbler/generated/"));
    expect(generatedDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 15_000);

  test("provides O(1) native route and socket handler lookup artifacts", async () => {
    const root = await phase2Project();
    const context = await compileProject(root);
    const optimized = context.generatedApplication!.optimized;
    const generated = await import(join(root, ".warbler", "generated", "routes.generated.ts"));
    const handlers = optimized.handlers.map((handler) => {
      const name = optimized.strings[handler.nameId]!;
      return (): Response => new Response(name);
    });
    const routes = generated.createRoutes(handlers);
    expect(await (await routes["/api/users"]!.GET!(new Request("http://localhost/api/users"))).text()).toContain("UsersController.list");
    expect(generated.routeLookup["GET /api/users"]).toBeTypeOf("number");
    const socketGenerated = await import(join(root, ".warbler", "generated", "socket.generated.ts"));
    const dispatchers = socketGenerated.createSocketDispatchers(handlers);
    const socketRecord = optimized.socketEvents.find((event) => optimized.strings[event.eventId] === "user.changed")!;
    expect(dispatchers[socketRecord.controllerId]!["user.changed"]).toBe(handlers[socketRecord.handlerId]);
  });

  test("generates an O(1) provider resolver from factory and dependency tables", async () => {
    const root = await phase2Project();
    const context = await compileProject(root);
    const optimized = context.generatedApplication!.optimized;
    const generated = await import(join(root, ".warbler", "generated", "providers.generated.ts"));
    const providerName = (id: number): string => optimized.strings[optimized.providers[id]!.nameId]!;
    const factories = optimized.providers.map((provider) =>
      (dependencies: readonly unknown[]) => Object.freeze({ name: providerName(provider.id), dependencies }),
    );
    const resolver = generated.createProviderResolver(factories);
    const usersId = optimized.providers.find((provider) => providerName(provider.id) === "UsersService")!.id;
    const users = resolver.resolve(usersId) as { readonly dependencies: readonly unknown[] };
    expect(users.dependencies).toHaveLength(1);
    expect(resolver.resolve(usersId)).toBe(users);
  });
});

describe("executable bindings", () => {
  test("emits executable bindings for inline defineHttpRoute graph routes", async () => {
    const root = await phase2Project();
    await Bun.write(join(root, "src", "application.ts"), `
      import { createApp } from "@warblerjs/core";
      import { defineHttpGraph, defineHttpRoute, TextRes } from "@warblerjs/http";
      import { defineValidator, v } from "@warblerjs/validators";

      export const ValidateUser = defineValidator({
        paramRules: { id: v.number() },
        queryRules: { page: v.number() },
      });

      export const http = defineHttpGraph({
        routes: {
          "GET /users/:id": defineHttpRoute({
            response: "text",
            validator: ValidateUser,
            run(ctx) {
              return TextRes(ctx.params.id' + : +'ctx.query.page);
            },
          }),
        },
      });

      export default createApp({ graphs: [http] });
    `);

    const context = await compileProject(root, { semanticDiagnostics: false });
    expect(context.diagnostics.filter((item) => item.code.startsWith("WARBLER_BINDING"))).toEqual([]);
    const directory = join(root, ".warbler", "generated");
    const handlers = await Bun.file(join(directory, "handlers.generated.ts")).text();
    const validators = await Bun.file(join(directory, "validators.generated.ts")).text();
    const http = await Bun.file(
      join(directory, "http.generated.ts"),
    ).text();

    expect(handlers).toContain("const Handler0 =");
    expect(handlers).toContain("defineHttpRoute");
    expect(handlers).toContain("ValidateUser");
    expect(handlers).toContain("Handler0.run(...input)");
    expect(validators).toContain("compileValidator");
    expect(validators).toContain("ValidateUser");
    expect(http).toContain('"flags":131201');
  }, 15_000);

  test("emits exported values, direct handlers, scopes, and one Runtime manifest", async () => {
    const root = await phase2Project();
    const context = await compileProject(root);
    expect(context.diagnostics.filter((item) => item.code.startsWith("WARBLER_BINDING"))).toEqual([]);
    const directory = join(root, ".warbler", "generated");
    for (const name of [
      "application.generated.ts", "bindings.generated.ts", "controllers.generated.ts",
      "handlers.generated.ts", "guards.generated.ts", "middleware.generated.ts",
      "validators.generated.ts", "http.generated.ts", "websocket.generated.ts",
      "production.generated.ts",
    ]) expect(await Bun.file(join(directory, name)).exists()).toBe(true);
    const handlers = await Bun.file(join(directory, "handlers.generated.ts")).text();
    expect(handlers).toContain("controller.list(");
    expect(handlers).toContain("parameterCount: 0");
    expect(handlers).not.toContain("controller[");
    const httpGenerated = await Bun.file(join(directory, "http.generated.ts")).text();
    expect(httpGenerated).not.toContain("prepareHttpValidationInput(request, 0)");
    expect(httpGenerated).toContain("executeHttpRoute(1, request)");
    expect(httpGenerated).toContain("httpRouteRequestRequirements");
    expect(httpGenerated).toContain("input instanceof Promise");
    const providers = await Bun.file(join(directory, "providers.generated.ts")).text();
    expect(providers).toContain("scope: \"root\"");
    expect(providers).toContain("scope: \"graph\"");
    expect(providers).toContain("import Binding");
    const generated = await import(join(directory, "application.generated.ts"));
    const runtime = createExecutableBindingsRuntime(generated.default);
    const users = context.generatedApplication!.bindings!.providers.find((item) => item.implementation?.imported === "UsersService")!;
    const instance = runtime.resolveProvider(users.graphId, users.id) as { readonly logger: unknown };
    expect(instance.logger).toBeDefined();
    const production = await import(join(directory, "production.generated.ts"));
    const launched = await production.startGeneratedApplication((bindings: unknown) => Object.freeze({ bindings }));
    expect(launched.bindings).toBe(generated.default);
  }, 15_000);

  test("rejects a required runtime symbol that is not exported", async () => {
    const root = await phase2Project();
    const sourcePath = join(root, "src", "application.ts");
    const source = await Bun.file(sourcePath).text();
    await Bun.write(sourcePath, source.replace("@Service({ provide: ProviderScope.ROOT }) export class Logger", "@Service({ provide: ProviderScope.ROOT }) class Logger"));
    const context = await compileProject(root);
    expect(context.generatedApplication).toBeUndefined();
    expect(context.diagnostics).toContainEqual(expect.objectContaining({
      code: "WARBLER_BINDING_NOT_EXPORTED",
      relatedSymbols: ["Logger"],
    }));
  }, 15_000);
});

describe("Named routes", () => {
  test("assigns a nameId for a route declared with `name`, and -1 for unnamed routes", async () => {
    const root = await phase2Project();
    const sourcePath = join(root, "src", "application.ts");
    const source = await Bun.file(sourcePath).text();
    await Bun.write(sourcePath, source.replace(
      '@Get("", { validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })',
      '@Get("", { name: "users.list", validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })',
    ));
    const optimized = (await compileProject(root)).generatedApplication!.optimized;
    const get = optimized.routes.find((route) => optimized.strings[route.methodId] === "GET")!;
    const post = optimized.routes.find((route) => optimized.strings[route.methodId] === "POST")!;
    expect(optimized.strings[get.nameId]).toBe("users.list");
    expect(post.nameId).toBe(-1);
  }, 15_000);

  test("named routes flow through to the generated httpRouteBindings rows unchanged", async () => {
    const root = await phase2Project();
    const sourcePath = join(root, "src", "application.ts");
    const source = await Bun.file(sourcePath).text();
    await Bun.write(sourcePath, source.replace(
      '@Get("", { validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })',
      '@Get("", { name: "users.list", validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })',
    ));
    await compileProject(root);
    const httpGenerated = await import(join(root, ".warbler", "generated", "http.generated.ts"));
    const tablesGenerated = await import(join(root, ".warbler", "generated", "tables.generated.ts"));
    const named = httpGenerated.httpRouteBindings.find((route: { nameId: number }) => route.nameId !== -1);
    expect(tablesGenerated.strings[named.nameId]).toBe("users.list");
  }, 15_000);

  test("rejects duplicate route names across the whole application", async () => {
    const root = await phase2Project();
    const sourcePath = join(root, "src", "application.ts");
    const source = await Bun.file(sourcePath).text();
    await Bun.write(sourcePath, source
      .replace(
        '@Get("", { validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })',
        '@Get("", { name: "users.same", validator: ValidateRequest, guards: [AuthGuard, AuthGuard], middleware: [AuditMiddleware], csrf: true })',
      )
      .replace('@Post("", { guards: [AuthGuard] }) create() {}', '@Post("", { guards: [AuthGuard], name: "users.same" }) create() {}'));
    const context = await compileProject(root);
    expect(context.diagnostics).toContainEqual(expect.objectContaining({ code: "WARBLER1013" }));
  }, 15_000);
});
