import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compiler, CompilerContext, compileApplication, compileProject } from "../src";

const temporaryProjects: string[] = [];

afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function project(source: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-compiler-"));
  temporaryProjects.push(root);
  await Bun.write(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, experimentalDecorators: true, noEmit: true },
    include: ["src/**/*.ts"],
  }));
  await Bun.write(join(root, "src", "application.ts"), source);
  await Bun.write(join(root, "dist", "ignored.ts"), "@Graph() class IgnoredGraph {}");
  return root;
}

describe("compiler foundation", () => {
  test("discovers Graphs, controllers, providers, routes, sockets, aliases, and dependencies", async () => {
    const root = await project(`
      import { Graph as G, Service as S, Repository, ProviderScope as PS, inject, Transport } from "@warblerjs/core";
      import { createApp } from "@warblerjs/core";
      import { Controller, Get, Post } from "@warblerjs/http";
      import { SocketController, Subscribe, OnOpen } from "@warblerjs/websocket";

      const globalMiddleware = (_request: unknown, _context: unknown, next: () => unknown) => next();
      const graphMiddleware = (_request: unknown, _context: unknown, next: () => unknown) => next();
      const controllerMiddleware = (_request: unknown, _context: unknown, next: () => unknown) => next();
      const routeMiddleware = (_request: unknown, _context: unknown, next: () => unknown) => next();
      @Repository() class UsersRepository {}
      @S() class UsersService { readonly repository = inject(UsersRepository); }
      @S({ provide: PS.ROOT }) class LoggerService {}

      @Controller({ prefix: "/users", middleware: [controllerMiddleware] }) class UsersController {
        @Get("/", { middleware: [routeMiddleware] }) list() {}
        @Post("/") create() {}
      }
      @SocketController() class UsersSocket {
        @OnOpen() open() {}
        @Subscribe("user.changed") changed() {}
      }
      @G({
        prefix: "/api",
        transport: Transport.HTTP,
        controllers: [UsersController, UsersSocket],
        providers: [UsersRepository, UsersService, LoggerService],
        middleware: [graphMiddleware],
      })
      class UsersGraph {}
      export default createApp({ graphs: [UsersGraph] });
    `);

    const context = await compileProject(root);
    expect(context).toBeInstanceOf(CompilerContext);
    expect(context.program.getTypeChecker()).toBe(context.typeChecker);
    expect(context.sourceFiles).toHaveLength(1);
    const wir = context.applicationWIR!;
    expect(Object.isFrozen(wir)).toBe(true);
    expect(wir.graphs).toHaveLength(1);
    expect(wir.middleware).toEqual([]);
    expect(wir.rootProviders.map((provider) => provider.name)).toEqual(["LoggerService"]);
    const graph = wir.graphs[0]!;
    expect(graph.name).toBe("UsersGraph");
    expect(graph.transport).toBe("http");
    expect(graph.middleware).toEqual(["graphMiddleware"]);
    expect(graph.controllers.map((controller) => controller.kind)).toEqual(["http", "websocket"]);
    expect(graph.controllers[0]!.middleware).toEqual(["controllerMiddleware"]);
    expect(graph.controllers[0]!.routes.map((route) => `${route.method} ${route.path}`)).toEqual(["GET /", "POST /"]);
    expect(graph.controllers[0]!.routes[0]!.middleware).toEqual(["routeMiddleware"]);
    expect(graph.controllers[1]!.socketEvents.map((event) => event.event)).toEqual(["open", "user.changed"]);
    expect(graph.providers.find((provider) => provider.name === "UsersService")?.dependencies).toEqual(["UsersRepository"]);
    expect(wir.graphs.some((item) => item.name === "IgnoredGraph")).toBe(false);
  });

  test("compileApplication returns metadata-only WIR", async () => {
    const root = await project(`import { Graph } from "@warblerjs/core"; @Graph() class AppGraph {}`);
    const wir = await compileApplication(root);
    expect(wir.version).toBe(1);
    expect(wir.graphs[0]?.name).toBe("AppGraph");
    expect("execute" in wir).toBe(false);
  });

  test("Compiler facade owns independent compilation state", async () => {
    const root = await project(`import { Graph } from "@warblerjs/core"; @Graph() class AppGraph {}`);
    const first = await new Compiler(root).compile();
    const second = await new Compiler(root).compile();
    expect(first).not.toBe(second);
    expect(first.program).not.toBe(second.program);
  });

  test("semantic diagnostics remain strict by default and can be skipped for development", async () => {
    const root = await project(`const value: string = 1; void value;`);
    const fast = await new Compiler(root).compile({ semanticDiagnostics: false });
    const strict = await new Compiler(root).compile();
    const semanticMessage = "Type 'number' is not assignable to type 'string'";

    expect(fast.diagnostics.some((diagnostic) => diagnostic.message.includes(semanticMessage))).toBe(false);
    expect(strict.diagnostics.some((diagnostic) => diagnostic.message.includes(semanticMessage))).toBe(true);
  });

  test("persistent compiler invalidates only changed source files", async () => {
    const root = await project(`
      import "./support";
      import { Graph } from "@warblerjs/core";
      @Graph() class AppGraph {}
    `);
    await Bun.write(join(root, "src", "support.ts"), `export const support = "stable";`);

    const compiler = new Compiler(root);
    const first = await compiler.compile({ semanticDiagnostics: false });
    const applicationPath = join(root, "src", "application.ts");
    const supportPath = join(root, "src", "support.ts");
    const firstApplication = first.program.getSourceFile(applicationPath);
    const firstSupport = first.program.getSourceFile(supportPath);

    await Bun.write(applicationPath, `
      import "./support";
      import { Graph } from "@warblerjs/core";
      @Graph() class ChangedGraph {}
    `);
    compiler.markChanged("src/application.ts");
    const second = await compiler.compile({ semanticDiagnostics: false });

    expect(second.program.getSourceFile(applicationPath)).not.toBe(firstApplication);
    expect(second.program.getSourceFile(applicationPath)?.text).toContain("ChangedGraph");
    expect(second.program.getSourceFile(supportPath)).toBe(firstSupport);
  });
});

describe("validation diagnostics", () => {
  test("reports declarative graph key and placement errors with source coordinates", async () => {
    const root = await project(`
      import { defineHandler, createApp } from "@warblerjs/core";
      import { defineHttpGraph } from "@warblerjs/http";
      import { defineWebSocketGraph } from "@warblerjs/websocket";
      const validator = {};
      const handler = defineHandler({ run: (_ctx: unknown) => undefined });
      export const http = defineHttpGraph({
        routes: {
          "GETW /test": handler,
          "get /test": handler,
          "GET test": handler,
          "POST /test": { handler, validator },
        },
      });
      export const socket = defineWebSocketGraph({
        events: {
          DRAINE: handler,
          "MSG ": handler,
          "SUB crash": { handler, guards: [] },
        },
      });
      export default createApp({ graphs: [http, socket] });
    `);

    const context = await compileProject(root, { semanticDiagnostics: false });
    const declarative = context.diagnostics.filter((diagnostic) => diagnostic.code === "WARBLER1008");
    expect(declarative.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Invalid HTTP route key "GETW /test"'),
      expect.stringContaining('Invalid HTTP route key "get /test"'),
      expect.stringContaining('Invalid HTTP route key "GET test"'),
      expect.stringContaining('Declarative route/event option "validator" is not allowed'),
      expect.stringContaining('Invalid WebSocket event key "DRAINE"'),
      expect.stringContaining('Invalid WebSocket event key "MSG "'),
      expect.stringContaining('Declarative route/event option "guards" is not allowed'),
    ]));
    for (const diagnostic of declarative) {
      expect(diagnostic.sourceFile.endsWith("src/application.ts")).toBe(true);
      expect(diagnostic.line).toBeGreaterThan(0);
      expect(diagnostic.column).toBeGreaterThan(0);
    }
  });

  test("reports duplicate routes and socket events with source coordinates", async () => {
    const root = await project(`
      import { Graph } from "@warblerjs/core";
      import { Controller, Get } from "@warblerjs/http";
      import { SocketController, Subscribe, OnOpen } from "@warblerjs/websocket";
      @Controller() class One { @Get("/same") one() {} }
      @Controller() class Two { @Get("/same") two() {} }
      @SocketController() class Socket {
        @Subscribe("same") one() {}
        @Subscribe("same") two() {}
        @OnOpen() openOne() {}
        @OnOpen() openTwo() {}
      }
      @Graph({ controllers: [One, Two, Socket] }) class AppGraph {}
    `);
    const context = await compileProject(root);
    const codes = context.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("WARBLER1002");
    expect(codes).toContain("WARBLER1003");
    for (const diagnostic of context.diagnostics.filter((item) => item.code.startsWith("WARBLER10") && item.code !== "WARBLER1099")) {
      expect(diagnostic.sourceFile.endsWith("application.ts")).toBe(true);
      expect(diagnostic.line).toBeGreaterThan(0);
      expect(diagnostic.column).toBeGreaterThan(0);
      expect(Object.isFrozen(diagnostic.relatedSymbols)).toBe(true);
    }
  });

  test("reports provider visibility, cycles, duplicate providers, missing ownership, and invalid usage", async () => {
    const root = await project(`
      import { Graph, Service, inject } from "@warblerjs/core";
      import { Get, Controller } from "@warblerjs/http";
      @Service() class LocalService {}
      @Service() class AdminService { readonly local = inject(LocalService); }
      @Service() class CycleA { readonly b = inject(CycleB); }
      @Service() class CycleB { readonly a = inject(CycleA); }
      @Service() class OrphanService {}
      class InvalidController { @Get("/") route() {} }
      @Controller() class UsersController {}
      @Graph({ controllers: [UsersController], providers: [LocalService] }) class UserGraph {}
      @Graph({ providers: [AdminService, CycleA, CycleB, CycleA] }) class AdminGraph {}
    `);
    const context = await compileProject(root);
    const codes = new Set(context.diagnostics.map((diagnostic) => diagnostic.code));
    expect(codes.has("WARBLER1004")).toBe(true);
    expect(codes.has("WARBLER1006")).toBe(true);
    expect(codes.has("WARBLER1007")).toBe(true);
    expect(codes.has("WARBLER1008")).toBe(true);
    expect(codes.has("WARBLER1009")).toBe(true);
  });
});
