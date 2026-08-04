import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { compileProject } from "../src";
import { RouteFlag, SocketFlag } from "../src/flags/flags";
import { createExecutableBindingsRuntime } from "@warbler/runtime";

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function phase2Project(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-phase2-"));
  temporaryProjects.push(root);
  const packagesRoot = resolve(import.meta.dir, "..", "..");
  const scope = join(root, "node_modules", "@warbler");
  mkdirSync(scope, { recursive: true });
  for (const name of ["config", "core", "http", "runtime", "transport", "websocket"]) {
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
    import { Graph, Service, ProviderScope, inject } from "@warbler/core";
    import { Controller, Get, Post } from "@warbler/http";
    import { SocketController, Subscribe, OnOpen } from "@warbler/websocket";
    export const ValidateMessage = (value: unknown) => value;
    export const ValidateRequest = (value: unknown) => value;
    export class AuthGuard {}
    export const SocketAuthGuard = () => true;
    export class AuditMiddleware {}

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
    expect(handlers).not.toContain("controller[");
    const providers = await Bun.file(join(directory, "providers.generated.ts")).text();
    expect(providers).toContain("scope: \"root\"");
    expect(providers).toContain("scope: \"graph\"");
    expect(providers).toContain("import Binding");
    const generated = await import(join(directory, "application.generated.ts"));
    const runtime = createExecutableBindingsRuntime(generated.default);
    const users = context.generatedApplication!.bindings!.providers.find((item) => item.symbol.imported === "UsersService")!;
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
