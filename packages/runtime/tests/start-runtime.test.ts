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
import { createGuardPipelineRegistry, linkGuardPipeline } from "../src/pipelines/execute-pipeline";

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
class LocalService {}
class LocalController {
  readonly local = inject(LocalService);
  show(): Response { return new Response(this.local instanceof LocalService ? "local" : "invalid"); }
}
class SocketController {
  handle(message: unknown, context: unknown): string {
    socketHandlerObservation = Object.freeze({ message, context });
    return "handled";
  }
}

let socketHandlerObservation: Readonly<{ message: unknown; context: unknown }> | undefined;

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
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
      Object.freeze({ id: 0, execute: (input: unknown, context: unknown, next: (value: unknown) => unknown) => { events.push("middleware"); return next(input); } }),
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
    expect(events.slice(-2)).toEqual(["middleware", "guard"]);
    await runtime.stop();
    await runtime.stop();
    expect(events.slice(-4)).toEqual(["transport:stop", "dispose:controller", "dispose:graph", "dispose:root"]);
  });

  test("runs middleware inside the owning Graph injection context", async () => {
    const events: string[] = [];
    const base = application(events);
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const launcher: RuntimeTransportLauncher = {
      kind: "http",
      start(input) {
        routes = (input.bindings as { readonly routes: typeof routes }).routes;
        return Object.freeze({});
      },
    };
    const runtime = await startRuntime({
      application: Object.freeze({
        ...base,
        middleware: Object.freeze([
          Object.freeze({
            id: 0,
            execute: (input: unknown, _context: unknown, next: (value: unknown) => unknown) => {
              events.push(inject(Users) instanceof Users ? "middleware:inject" : "middleware:invalid");
              return next(input);
            },
          }),
        ]),
      }),
      runtimeConfig: runtimeConfig(true),
      transportLaunchers: [launcher],
    });
    const response = await routes["/users"]!.GET!(new Request("http://localhost/users"));
    expect(response.status).toBe(200);
    expect(events).toContain("middleware:inject");
    await runtime.stop();
  });

  test("executes compiled middleware ranges before guards and preserves next semantics", async () => {
    const events: string[] = [];
    const base = application(events);
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: Object.freeze({
        ...base,
        application: Object.freeze({
          ...base.application,
          routeTable: Object.freeze([
            Object.freeze({ ...base.application.routeTable[0]!, middlewareCount: 5 }),
            Object.freeze({
              id: 1, controllerId: 0, handlerId: 0, validatorId: -1,
              guardStart: 1, guardCount: 1, middlewareStart: 5, middlewareCount: 1,
            }),
          ]),
          routeGuards: Object.freeze([0, 0]),
          routeMiddleware: Object.freeze([0, 1, 2, 1, 3, 4]),
        }),
        middleware: Object.freeze([
          Object.freeze({
            id: 0,
            execute: (input: unknown, context: { set: (key: string, value: unknown) => void }, next: (value?: unknown) => unknown) => {
              events.push("global:before");
              context.set("requestId", "req-1");
              const result = next(input);
              if (isThenable(result)) return result.then((value) => { events.push("global:after"); return value; });
              events.push("global:after");
              return result;
            },
          }),
          Object.freeze({
            id: 1,
            execute: (input: unknown, _context: unknown, next: (value?: unknown) => unknown) => {
              events.push("shared");
              return next(input);
            },
          }),
          Object.freeze({
            id: 2,
            execute: (input: unknown, context: { set: (key: string, value: unknown) => void }, next: (value?: unknown) => unknown) => {
              events.push("graph");
              context.set("tenant", "acme");
              return next(input);
            },
          }),
          Object.freeze({
            id: 3,
            execute: (input: unknown, context: { set: (key: string, value: unknown) => void }, next: (value?: unknown) => unknown) => {
              events.push("route");
              context.set("audit", "yes");
              return next(input);
            },
          }),
          Object.freeze({
            id: 4,
            execute: () => {
              events.push("short");
              return new Response("short", { status: 202 });
            },
          }),
        ]),
        guards: Object.freeze([
          Object.freeze({
            id: 0,
            execute: (_input: unknown, context: { get: (key: string) => unknown }) => {
              events.push(`guard:${context.get("requestId")}:${context.get("tenant")}:${context.get("audit")}`);
              return true;
            },
          }),
        ]),
        http: Object.freeze({
          routes: Object.freeze([Object.freeze({ id: 0 }), Object.freeze({ id: 1 })]),
          createRoutes: (execute: HttpRouteExecutor) => Object.freeze({
            "/all": Object.freeze({ GET: (request: Request) => execute(0, request) }),
            "/short": Object.freeze({ GET: (request: Request) => execute(1, request) }),
          }),
        }),
      }),
      runtimeConfig: runtimeConfig(true),
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
    });
    expect(await (await routes["/all"]!.GET!(new Request("http://localhost/all"))).text()).toBe("GET:true");
    expect(events.slice(-7)).toEqual([
      "global:before",
      "shared",
      "graph",
      "shared",
      "route",
      "guard:req-1:acme:yes",
      "global:after",
    ]);
    events.length = 0;
    const short = await routes["/short"]!.GET!(new Request("http://localhost/short"));
    expect(short.status).toBe(202);
    expect(await short.text()).toBe("short");
    expect(events).toEqual(["short"]);
    await runtime.stop();
  });

  test("creates controller-scoped providers inside the owning Controller container", async () => {
    const events: string[] = [];
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const launcher: RuntimeTransportLauncher = {
      kind: "http",
      start(input) {
        routes = (input.bindings as { readonly routes: typeof routes }).routes;
        return Object.freeze({ listening: true });
      },
      stop() {},
    };
    const runtime = await startRuntime({
      application: Object.freeze({
        application: Object.freeze({
          strings: Object.freeze([]), graphIds: Object.freeze({ AppGraph: 0 }),
          providerTable: Object.freeze([
            Object.freeze({ id: 0, nameId: 0, graphId: 0, controllerId: 0, scope: "controller", dependencyStart: 0, dependencyCount: 0 }),
          ]),
          providerDependencies: Object.freeze([]),
          routeTable: Object.freeze([Object.freeze({ id: 0, controllerId: 0, handlerId: 0, validatorId: -1, guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 0, flags: 0 })]),
          socketEventTable: Object.freeze([]),
          routeGuards: Object.freeze([]), routeMiddleware: Object.freeze([]), socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
        }),
        providers: Object.freeze([
          Object.freeze({
            id: 0, token: LocalService, scope: "controller", graphId: 0, controllerId: 0, dependencyIds: Object.freeze([]),
            factory: (context: ProviderBindingContext) => context.run(() => { events.push("provider:controller"); return new LocalService(); }),
          }),
        ]),
        controllers: Object.freeze([
          Object.freeze({
            id: 0, graphId: 0, transport: "http", token: LocalController, providerIds: Object.freeze([0]),
            factory: (context: ProviderBindingContext) => context.run(() => { events.push("controller"); return new LocalController(); }),
          }),
        ]),
        handlers: Object.freeze([
          Object.freeze({ id: 0, controllerId: 0, parameterCount: 0, invoke: (controller: LocalController) => controller.show() }),
        ]),
        guards: Object.freeze([]), middleware: Object.freeze([]), validators: Object.freeze([]),
        http: Object.freeze({
          routes: Object.freeze([Object.freeze({ id: 0 })]),
          createRoutes: (execute: HttpRouteExecutor) => Object.freeze({ "/local": Object.freeze({ GET: (request: Request) => execute(0, request) }) }),
        }),
      }),
      runtimeConfig: runtimeConfig(true),
      transportLaunchers: [launcher],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    expect(events).toEqual(["provider:controller", "controller"]);
    expect(await (await routes["/local"]!.GET!(new Request("http://localhost/local"))).text()).toBe("local");
    await runtime.stop();
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

  test("validated WebSocket envelopes copy own enumerable message fields, replace data, freeze once, and preserve originals", async () => {
    let dispatch: ((event: string, message: unknown, context: unknown) => unknown) | undefined;
    let middlewareEnvelope: unknown;
    socketHandlerObservation = undefined;
    const app: GeneratedApplicationBindings = Object.freeze({
      application: Object.freeze({
        strings: Object.freeze([]), graphIds: Object.freeze({ SocketGraph: 0 }),
        providerTable: Object.freeze([]), providerDependencies: Object.freeze([]),
        routeTable: Object.freeze([]),
        socketEventTable: Object.freeze([Object.freeze({
          id: 0, controllerId: 0, handlerId: 0, validatorId: 0,
          guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 1,
        })]),
        routeGuards: Object.freeze([]), routeMiddleware: Object.freeze([]),
        socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([0]),
      }),
      providers: Object.freeze([]),
      controllers: Object.freeze([
        Object.freeze({ id: 0, graphId: 0, transport: "websocket", token: SocketController, factory: () => new SocketController() }),
      ]),
      handlers: Object.freeze([
        Object.freeze({
          id: 0, controllerId: 0, parameterCount: 2,
          invoke: (controller: SocketController, message: unknown, context: unknown) => controller.handle(message, context),
        }),
      ]),
      guards: Object.freeze([]),
      middleware: Object.freeze([
        Object.freeze({
          id: 0,
          execute: (input: unknown, _context: unknown, next: (value: unknown) => unknown) => {
            middlewareEnvelope = input;
            return next(input);
          },
        }),
      ]),
      validators: Object.freeze([
        Object.freeze({
          id: 0,
          flags: 1,
          validate: () => Object.freeze({ valid: true, value: Object.freeze({ roomId: "validated" }) }),
        }),
      ]),
      websocket: Object.freeze({
        events: Object.freeze({
          "room.join": Object.freeze({
            id: 0, controllerId: 0, handlerId: 0, validatorId: 0,
            guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 1,
          }),
        }),
      }),
    });
    const launcher: RuntimeTransportLauncher = {
      kind: "websocket",
      start(input) {
        dispatch = (input.bindings as { readonly dispatch: typeof dispatch }).dispatch;
        return Object.freeze({});
      },
    };
    const runtime = await startRuntime({
      application: app,
      runtimeConfig: runtimeConfig(false, true),
      transportLaunchers: [launcher],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const originalMessage = Object.create({ inherited: "blocked" }) as Record<string, unknown>;
    originalMessage.event = "room.join";
    originalMessage.data = Object.freeze({ raw: "input" });
    originalMessage.extra = "keep";
    Object.defineProperty(originalMessage, "hidden", { enumerable: false, value: "secret" });
    const context = Object.freeze({ connectionId: "socket-1" });
    expect(await dispatch!("room.join", originalMessage, context)).toBe("handled");
    const envelope = middlewareEnvelope as { readonly message: Readonly<Record<string, unknown>>; readonly context: unknown };
    expect(socketHandlerObservation).toBeDefined();
    const observation = socketHandlerObservation as unknown as Readonly<{ message: unknown; context: unknown }>;
    const received = observation.message as Readonly<Record<string, unknown>>;
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.message)).toBe(true);
    expect(received).toBe(envelope.message);
    expect(received).not.toBe(originalMessage);
    expect(received.event).toBe("room.join");
    expect(received.extra).toBe("keep");
    expect(received.data).toEqual({ roomId: "validated" });
    expect(Object.prototype.hasOwnProperty.call(received, "hidden")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(received, "inherited")).toBe(false);
    expect(envelope.context).toBe(context);
    expect(observation.context).toBe(context);
    expect(originalMessage.data).toEqual({ raw: "input" });
    expect(originalMessage.extra).toBe("keep");
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
    ], [0, 1, 2], {}, undefined);
    expect(sync).toBe(false);
    expect(sync).not.toBeInstanceOf(Promise);
    expect(calls).toEqual([0, 1]);
    expect(await executeGuardRange([{ id: 0, execute: async () => true }], [0], {}, undefined)).toBe(true);
    const response = new Response("stop", { status: 401 });
    expect(executeGuardRange([{ id: 0, execute: () => response }, { id: 1, execute: () => { calls.push(9); return true; } }], [0, 1], {}, undefined)).toBe(response);
    expect(calls).toEqual([0, 1]);
    expect(() => executeGuardRange([{ id: 0, execute: () => "yes" }], [0], {}, undefined)).toThrow(InvalidGuardResultError);
  });

  test("links and deduplicates guard pipelines before request execution", async () => {
    const calls: string[] = [];
    const registry = createGuardPipelineRegistry();
    const bindings = Object.freeze([
      Object.freeze({ id: 0, execute: () => { calls.push("auth"); return true; } }),
      Object.freeze({ id: 1, execute: async () => { calls.push("tenant"); return true; } }),
      Object.freeze({ id: 2, execute: () => { calls.push("admin"); return false; } }),
    ]);

    const first = linkGuardPipeline(bindings, Object.freeze([0, 1]), registry);
    const reused = linkGuardPipeline(bindings, Object.freeze([0, 1]), registry);
    const different = linkGuardPipeline(bindings, Object.freeze([0, 2, 1]), registry);

    expect(reused).toBe(first);
    expect(different).not.toBe(first);
    expect(first.ids).toEqual([0, 1]);
    const result = first.execute({}, undefined);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(true);
    expect(calls).toEqual(["auth", "tenant"]);
    calls.length = 0;
    expect(different.execute({}, undefined)).toBe(false);
    expect(calls).toEqual(["auth", "admin"]);
    expect(() => linkGuardPipeline(Object.freeze([Object.freeze({ id: 0, execute: () => "yes" })]), Object.freeze([0]), createGuardPipelineRegistry()).execute({}, undefined)).toThrow(InvalidGuardResultError);
  });

  test("guard Response results short-circuit without running later guards or the handler", async () => {
    const events: string[] = [];
    const base = application(events);
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const app = Object.freeze({
      ...base,
      application: Object.freeze({
        ...base.application,
        routeTable: Object.freeze([
          Object.freeze({ ...base.application.routeTable[0]!, guardCount: 3, middlewareCount: 0 }),
          Object.freeze({
            id: 1, controllerId: 0, handlerId: 0, validatorId: -1,
            guardStart: 3, guardCount: 1, middlewareStart: 0, middlewareCount: 0,
          }),
          Object.freeze({
            id: 2, controllerId: 0, handlerId: 0, validatorId: -1,
            guardStart: 4, guardCount: 1, middlewareStart: 0, middlewareCount: 0,
          }),
        ]),
        routeGuards: Object.freeze([0, 1, 2, 3, 4]),
        routeMiddleware: Object.freeze([]),
      }),
      guards: Object.freeze([
        Object.freeze({ id: 0, execute: () => { events.push("guard:true"); return true; } }),
        Object.freeze({ id: 1, execute: () => { events.push("guard:response"); return new Response("redirect", { status: 302, headers: { location: "/" } }); } }),
        Object.freeze({ id: 2, execute: () => { events.push("guard:late"); return true; } }),
        Object.freeze({ id: 3, execute: async () => { events.push("guard:async-response"); return Response.json({ error: "Unauthorized" }, { status: 401 }); } }),
        Object.freeze({ id: 4, execute: () => { events.push("guard:false"); return false; } }),
      ]),
      handlers: Object.freeze([
        Object.freeze({
          ...base.handlers[0]!,
          invoke: (controller: UsersController, request: Request) => {
            events.push("handler");
            return controller.list(request);
          },
        }),
      ]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 }), Object.freeze({ id: 1 }), Object.freeze({ id: 2 })]),
        createRoutes: (execute: HttpRouteExecutor) => Object.freeze({
          "/response": Object.freeze({ GET: (request: Request) => execute(0, request) }),
          "/async-response": Object.freeze({ GET: (request: Request) => execute(1, request) }),
          "/false": Object.freeze({ GET: (request: Request) => execute(2, request) }),
        }),
      }),
    });
    const runtime = await startRuntime({
      application: app,
      runtimeConfig: runtimeConfig(true),
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
    });
    events.length = 0;
    const redirect = await routes["/response"]!.GET!(new Request("http://localhost/response"));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/");
    expect(events).toEqual(["guard:true", "guard:response"]);
    events.length = 0;
    const unauthorized = await routes["/async-response"]!.GET!(new Request("http://localhost/async-response"));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });
    expect(events).toEqual(["guard:async-response"]);
    events.length = 0;
    const forbiddenResponse = await routes["/false"]!.GET!(new Request("http://localhost/false"));
    expect(forbiddenResponse.status).toBe(403);
    expect(events).toEqual(["guard:false"]);
    await runtime.stop();
  });
});

describe("validator onValidationError", () => {
  const errors = Object.freeze({ "body.name": Object.freeze([Object.freeze({
    source: "body", path: Object.freeze(["name"]), field: "name", code: "invalid_type",
    message: Object.freeze({ key: "validators.invalid_name", parameters: Object.freeze({}) }),
  })]) });

  function invalidApplication(
    events: string[],
    validate: (input: unknown) => unknown,
  ): GeneratedApplicationBindings {
    const base = application(events);
    return Object.freeze({
      ...base,
      validators: Object.freeze([Object.freeze({ id: 0, validate })]),
    });
  }

  test("runs the compiled handler with the raw request and structured errors, and skips the default response", async () => {
    const events: string[] = [];
    const seen: { req?: unknown; errors?: unknown } = {};
    const base = application(events);
    const app = Object.freeze({
      ...base,
      validators: Object.freeze([Object.freeze({
        id: 0,
        validate: () => Object.freeze({ valid: false, errors }),
        onValidationError: (req: unknown, receivedErrors: unknown) => {
          seen.req = req; seen.errors = receivedErrors;
          return Response.json({ custom: true }, { status: 422 });
        },
      })]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 })]),
        createRoutes: (execute: HttpRouteExecutor) => Object.freeze({
          "/users": Object.freeze({
            GET: (request: Request) => execute(0, request, Object.freeze({
              value: Object.freeze({ name: 5 }), query: Object.freeze({}), path: Object.freeze({ id: "1" }),
              headers: Object.freeze({}), cookies: Object.freeze({}),
            })),
          }),
        }),
      }),
    });
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const http: RuntimeTransportLauncher = { kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } };
    const runtime = await startRuntime({ application: app, runtimeConfig: runtimeConfig(true), transportLaunchers: [http] });
    // Real BunRequest instances carry `.params` populated by Bun's router before Warbler
    // ever sees the request; a plain `Request` doesn't, so it's attached here to match.
    const request = new Request("http://localhost/users/1");
    Object.defineProperty(request, "params", { value: Object.freeze({ id: "1" }) });
    const response = await routes["/users"]!.GET!(request);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ custom: true });
    expect(events).not.toContain("middleware");
    expect(seen.errors).toEqual(errors);
    const req = seen.req as { body: unknown; params: unknown; headers: unknown; cookies: unknown; native: unknown };
    expect(req.body).toEqual({ name: 5 });
    expect(req.params).toEqual({ id: "1" });
    expect(req.headers).toBeInstanceOf(Headers);
    expect(req.cookies).toBeInstanceOf(Bun.CookieMap);
    expect(req.native).toBeInstanceOf(Request);
    await runtime.stop();
  });

  test("awaits an async handler and returns its response", async () => {
    const events: string[] = [];
    const base = application(events);
    const app = Object.freeze({
      ...base,
      validators: Object.freeze([Object.freeze({
        id: 0,
        validate: () => Object.freeze({ valid: false, errors }),
        onValidationError: async (): Promise<Response> => { await Bun.sleep(0); return Response.json({ async: true }, { status: 422 }); },
      })]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 })]),
        createRoutes: (execute: HttpRouteExecutor) => Object.freeze({ "/users": Object.freeze({ GET: (request: Request) => execute(0, request, Object.freeze({})) }) }),
      }),
    });
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const http: RuntimeTransportLauncher = { kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } };
    const runtime = await startRuntime({ application: app, runtimeConfig: runtimeConfig(true), transportLaunchers: [http] });
    const response = await routes["/users"]!.GET!(new Request("http://localhost/users"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ async: true });
    await runtime.stop();
  });

  test("falls back to the existing default validation response when no handler is compiled", async () => {
    const events: string[] = [];
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const http: RuntimeTransportLauncher = {
      kind: "http",
      start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); },
    };
    const runtime = await startRuntime({
      application: invalidApplication(events, () => Object.freeze({ valid: false, errors })),
      runtimeConfig: runtimeConfig(true),
      transportLaunchers: [http],
    });
    const response = await routes["/users"]!.GET!(new Request("http://localhost/users"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ name: "validators.invalid_name" });
    expect(events).not.toContain("middleware");
    await runtime.stop();
  });

  // The unified exception boundary (@warbler/http's `createBunRouteHandler`, one layer
  // above the Runtime pipeline tested here) now catches exactly this rejection and
  // renders it safely — see packages/http/tests/native-server.test.ts's "unified
  // exception boundary" suite. This test's contract is intentionally unchanged: the
  // Runtime pipeline itself still propagates raw, by design, so any HTTP-transport-
  // specific concern (JSON/text rendering, dev vs prod, Console logging) stays out of
  // the transport-agnostic Runtime layer. It also directly proves `onValidationError`
  // throwing does not get swallowed or recursively re-enter validation — `events` never
  // gains a "middleware" entry, meaning it never falls through to the success path.
  test("lets a throwing handler propagate instead of swallowing or recursing", async () => {
    const events: string[] = [];
    const base = application(events);
    const app = Object.freeze({
      ...base,
      validators: Object.freeze([Object.freeze({
        id: 0,
        validate: () => Object.freeze({ valid: false, errors }),
        onValidationError: () => { throw new Error("handler failure"); },
      })]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 })]),
        // Forces the async wrapper shape used by body-reading validated routes; synchronous
        // throws inside that wrapper become promise rejections, matching controller throws.
        createRoutes: (execute: HttpRouteExecutor) => Object.freeze({
          "/users": Object.freeze({ GET: (request: Request) => Promise.resolve().then(() => execute(0, request, Object.freeze({}))) }),
        }),
      }),
    });
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const http: RuntimeTransportLauncher = { kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } };
    const runtime = await startRuntime({ application: app, runtimeConfig: runtimeConfig(true), transportLaunchers: [http] });
    await expect(routes["/users"]!.GET!(new Request("http://localhost/users"))).rejects.toThrow("handler failure");
    await runtime.stop();
  });
});
