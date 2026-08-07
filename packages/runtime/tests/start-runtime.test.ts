import { describe, expect, test } from "bun:test";
import { inject } from "@warbler/core";
import type { RuntimeConfig } from "@warbler/config";
import {
  GeneratedRuntimeOwner,
  InvalidApplicationBindingsError,
  InvalidGuardResultError,
  RuntimeState,
  RuntimeTransportError,
  ProviderResolutionError,
  executeGuardRange,
  startRuntime,
  type GeneratedApplicationBindings,
  type HttpRouteExecutor,
  type ProviderBindingContext,
  type RuntimeTransportLauncher,
} from "../src";

const runtimeConfig = (http: boolean, websocket = false): RuntimeConfig => Object.freeze({
  network: Object.freeze({ host: "127.0.0.1" }),
  transports: Object.freeze({
    http: Object.freeze({ enabled: http, port: 3000 }),
    websocket: Object.freeze({ enabled: websocket, ...(websocket ? { port: 3001, mode: "standalone" as const } : {}) }),
    tcp: Object.freeze({ enabled: false }),
    udp: Object.freeze({ enabled: false }),
    mcp: Object.freeze({ enabled: false }),
    webrtc: Object.freeze({ enabled: false }),
  }),
  telemetry: Object.freeze({
    metrics: Object.freeze({ enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" }),
    healthCheck: Object.freeze({ enabled: false, host: "127.0.0.1", port: 9091, path: "/health" }),
  }),
});

class Logger {}
class Users {
  readonly logger = inject(Logger);
}
class UsersController {
  readonly users = inject(Users);
  list(request: Request): Response { return new Response(`${request.method}:${this.users.logger instanceof Logger}`); }
}

function application(events: string[], valid = true): GeneratedApplicationBindings {
  return Object.freeze({
    application: Object.freeze({
      strings: Object.freeze([]), graphIds: Object.freeze({ UsersGraph: 0 }),
      providerTable: Object.freeze([
        Object.freeze({ id: 0, nameId: 0, graphId: -1, scope: "root", dependencyStart: 0, dependencyCount: 0 }),
        Object.freeze({ id: 1, nameId: 1, graphId: 0, scope: "graph", dependencyStart: 0, dependencyCount: 1 }),
      ]),
      providerDependencies: Object.freeze([0]),
      routeTable: Object.freeze([Object.freeze({
        id: 0, controllerId: 0, handlerId: 0, validatorId: 0,
        guardStart: 0, guardCount: 1, middlewareStart: 0, middlewareCount: 1,
      })]),
      socketEventTable: Object.freeze([]),
      routeGuards: Object.freeze([0]), routeMiddleware: Object.freeze([0]),
      socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
    }),
    providers: Object.freeze([
      Object.freeze({
        id: 0, token: Logger, scope: "root", dependencyIds: Object.freeze([]),
        factory: async () => { events.push("provider:root"); return new Logger(); },
        dispose: () => { events.push("dispose:root"); },
      }),
      Object.freeze({
        id: 1, token: Users, scope: "graph", graphId: 0, dependencyIds: Object.freeze([0]),
        factory: (context: ProviderBindingContext) => context.run(() => { events.push("provider:graph"); return new Users(); }),
        dispose: () => { events.push("dispose:graph"); },
      }),
    ]),
    controllers: Object.freeze([
      Object.freeze({
        id: 0, graphId: 0, transport: "http", token: UsersController,
        factory: (context: ProviderBindingContext) => context.run(() => { events.push("controller"); return new UsersController(); }),
        dispose: () => { events.push("dispose:controller"); },
      }),
    ]),
    handlers: Object.freeze([
      Object.freeze({ id: 0, controllerId: 0, invoke: (controller: UsersController, request: Request) => controller.list(request) }),
    ]),
    guards: Object.freeze([
      Object.freeze({ id: 0, execute: () => { events.push("guard"); return true; } }),
    ]),
    middleware: Object.freeze([
      Object.freeze({ id: 0, execute: (input: unknown, next: (value: unknown) => unknown) => { events.push("middleware"); return next(input); } }),
    ]),
    validators: Object.freeze([
      Object.freeze({ id: 0, validate: (input: unknown) => valid ? input : Object.freeze({ valid: false }) }),
    ]),
    http: Object.freeze({
      routes: Object.freeze([Object.freeze({ id: 0 })]),
      createRoutes: (execute: HttpRouteExecutor) => Object.freeze({ "/users": Object.freeze({ GET: (request: Request) => execute(0, request) }) }),
    }),
  });
}

describe("startRuntime generated binding consumption", () => {
  test("eagerly creates providers and Controllers, executes the compiled pipeline, and stops in reverse ownership order", async () => {
    const events: string[] = [];
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const launcher: RuntimeTransportLauncher = {
      kind: "http",
      start(input) {
        events.push("transport:start");
        routes = (input.bindings as { readonly routes: typeof routes }).routes;
        return Object.freeze({ listening: true });
      },
      stop() { events.push("transport:stop"); },
    };
    let configLoads = 0;
    const runtime = await startRuntime({
      application: application(events),
      runtimeConfig: runtimeConfig(true),
      transportLaunchers: [launcher],
      transportConfigLoader: async (kind) => { configLoads++; return Object.freeze({ kind }); },
    });
    expect(runtime.state).toBe(RuntimeState.RUNNING);
    expect(events.slice(0, 4)).toEqual(["provider:root", "provider:graph", "controller", "transport:start"]);
    expect(configLoads).toBe(1);
    expect(await (await routes["/users"]!.GET!(new Request("http://localhost/users"))).text()).toBe("GET:true");
    expect(events.slice(-2)).toEqual(["guard", "middleware"]);
    await runtime.stop();
    await runtime.stop();
    expect(events.slice(-4)).toEqual(["transport:stop", "dispose:controller", "dispose:graph", "dispose:root"]);
  });

  test("does not start a disabled transport and prevents invalid validation from reaching middleware or Handler", async () => {
    const events: string[] = [];
    let loads = 0;
    let websocketStarts = 0;
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const http: RuntimeTransportLauncher = {
      kind: "http",
      start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); },
    };
    const websocket: RuntimeTransportLauncher = {
      kind: "websocket", start() { websocketStarts++; return Object.freeze({}); },
    };
    const runtime = await startRuntime({
      application: application(events, false),
      runtimeConfig: runtimeConfig(true, false),
      transportLaunchers: [http, websocket],
      transportConfigLoader: async () => { loads++; return Object.freeze({}); },
    });
    expect(loads).toBe(1);
    expect(websocketStarts).toBe(0);
    const response = await routes["/users"]!.GET!(new Request("http://localhost/users"));
    expect(response.status).toBe(400);
    expect(events).not.toContain("middleware");
    await runtime.stop();
  });

  test("rolls back a partially started transport set and provider ownership on failure", async () => {
    const events: string[] = [];
    const http: RuntimeTransportLauncher = {
      kind: "http", start: () => { events.push("http:start"); return Object.freeze({}); },
      stop: () => { events.push("http:stop"); },
    };
    const websocket: RuntimeTransportLauncher = {
      kind: "websocket", start: () => { events.push("websocket:start"); throw new Error("private"); },
    };
    const owner = new GeneratedRuntimeOwner({
      application: application(events), runtimeConfig: runtimeConfig(true, true),
      transportLaunchers: [http, websocket],
      transportConfigLoader: async () => Object.freeze({}),
    });
    await expect(owner.start()).rejects.toBeInstanceOf(RuntimeTransportError);
    expect(owner.state).toBe(RuntimeState.FAILED);
    expect(events.slice(-4)).toEqual(["http:stop", "dispose:controller", "dispose:graph", "dispose:root"]);
  });

  test("disposes already-created providers when an asynchronous factory fails", async () => {
    const events: string[] = [];
    const base = application(events);
    const failing = Object.freeze({
      ...base,
      providers: Object.freeze([
        base.providers[0]!,
        Object.freeze({ ...base.providers[1]!, factory: async () => { throw new Error("secret"); } }),
      ]),
    });
    await expect(startRuntime({ application: failing, runtimeConfig: runtimeConfig(false) })).rejects.toBeInstanceOf(ProviderResolutionError);
    expect(events).toEqual(["provider:root", "dispose:root"]);
  });

  test("honors AbortSignal shutdown", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const runtime = await startRuntime({ application: application(events), runtimeConfig: runtimeConfig(false), signal: controller.signal });
    controller.abort();
    await Bun.sleep(0);
    expect(runtime.state).toBe(RuntimeState.STOPPED);
  });
});

describe("binding validation and Guard execution", () => {
  test("rejects duplicate binding IDs and invalid dependency IDs before factories run", async () => {
    const events: string[] = [];
    const base = application(events);
    const duplicate = Object.freeze({ ...base, providers: Object.freeze([base.providers[0]!, Object.freeze({ ...base.providers[1]!, id: 0 })]) });
    await expect(startRuntime({ application: duplicate, runtimeConfig: runtimeConfig(false) })).rejects.toBeInstanceOf(InvalidApplicationBindingsError);
    expect(events).toEqual([]);
    const invalidDependency = Object.freeze({
      ...base,
      providers: Object.freeze([base.providers[0]!, Object.freeze({ ...base.providers[1]!, dependencyIds: Object.freeze([99]) })]),
    });
    await expect(startRuntime({ application: invalidDependency, runtimeConfig: runtimeConfig(false) })).rejects.toBeInstanceOf(InvalidApplicationBindingsError);
  });

  test("rejects invalid Graph, Handler, Guard, Middleware, and Validator references", async () => {
    const base = application([]);
    const cases: GeneratedApplicationBindings[] = [
      Object.freeze({ ...base, controllers: Object.freeze([Object.freeze({ ...base.controllers[0]!, graphId: 9 })]) }),
      Object.freeze({ ...base, handlers: Object.freeze([Object.freeze({ ...base.handlers[0]!, controllerId: 9 })]) }),
      Object.freeze({
        ...base,
        application: Object.freeze({ ...base.application, routeTable: Object.freeze([Object.freeze({ ...base.application.routeTable[0]!, guardCount: 2 })]) }),
      }),
      Object.freeze({
        ...base,
        application: Object.freeze({ ...base.application, routeTable: Object.freeze([Object.freeze({ ...base.application.routeTable[0]!, middlewareCount: 2 })]) }),
      }),
      Object.freeze({
        ...base,
        application: Object.freeze({ ...base.application, routeTable: Object.freeze([Object.freeze({ ...base.application.routeTable[0]!, validatorId: 9 })]) }),
      }),
    ];
    for (const candidate of cases) {
      await expect(startRuntime({ application: candidate, runtimeConfig: runtimeConfig(false) })).rejects.toBeInstanceOf(InvalidApplicationBindingsError);
    }
  });

  test("keeps synchronous Guards synchronous, stops on false, awaits async Guards, and rejects invalid results", async () => {
    const calls: number[] = [];
    const sync = executeGuardRange([
      { id: 0, execute: () => { calls.push(0); return true; } },
      { id: 1, execute: () => { calls.push(1); return false; } },
      { id: 2, execute: () => { calls.push(2); return true; } },
    ], [0, 1, 2], {});
    expect(sync).toBe(false);
    expect(sync).not.toBeInstanceOf(Promise);
    expect(calls).toEqual([0, 1]);
    expect(await executeGuardRange([{ id: 0, execute: async () => true }], [0], {})).toBe(true);
    expect(() => executeGuardRange([{ id: 0, execute: () => "yes" }], [0], {})).toThrow(InvalidGuardResultError);
  });
});
