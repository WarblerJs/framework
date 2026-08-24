import { describe, expect, test } from "bun:test";
import type { RuntimeConfig } from "@warblerjs/config";
import {
  GeneratedArtifactError,
  InvalidRuntimeStateError,
  RuntimeProviderContainers,
  RuntimeProviderNotFoundError,
  RuntimeState,
  bootstrapApplication,
  createRuntime,
  loadGeneratedApplication,
  type RuntimeGeneratedApplication,
  type RuntimeProviderFactory,
  type RuntimeRouteHandler,
  type RuntimeSocketHandler,
  type RuntimeTransportAdapter,
} from "../src";

const generated: RuntimeGeneratedApplication = Object.freeze({
  strings: Object.freeze(["Logger", "UsersService", "AdminService", "UserOnly"]),
  graphIds: Object.freeze({ UserGraph: 0, AdminGraph: 1 }),
  providerTable: Object.freeze([
    Object.freeze({ id: 0, nameId: 0, graphId: -1, scope: "root", dependencyStart: 0, dependencyCount: 0 }),
    Object.freeze({ id: 1, nameId: 1, graphId: 0, scope: "graph", dependencyStart: 0, dependencyCount: 1 }),
    Object.freeze({ id: 2, nameId: 2, graphId: 1, scope: "graph", dependencyStart: 1, dependencyCount: 1 }),
    Object.freeze({ id: 3, nameId: 3, graphId: 0, scope: "graph", dependencyStart: 2, dependencyCount: 0 }),
  ]),
  providerDependencies: Object.freeze([0, 0]),
  routeTable: Object.freeze([Object.freeze({ id: 0 })]),
  socketEventTable: Object.freeze([Object.freeze({ id: 0 })]),
  createRoutes(handlers: readonly RuntimeRouteHandler[]) {
    return Object.freeze({ "/users": Object.freeze({ GET: handlers[0]! }) });
  },
  createSocketDispatchers(handlers: readonly RuntimeSocketHandler[]) {
    return Object.freeze({ 0: Object.freeze({ "user.changed": handlers[0]! }) });
  },
  createSocketLifecycleHandlers(handlers: readonly RuntimeSocketHandler[]) {
    return Object.freeze({ 0: Object.freeze({ open: handlers[1]! }) });
  },
});

const configuration: RuntimeConfig = Object.freeze({
  network: Object.freeze({ host: "127.0.0.1" }),
  transports: Object.freeze({
    http: Object.freeze({ enabled: true, port: 3000 }),
    websocket: Object.freeze({ enabled: false }),
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

function factories(log: string[] = []): readonly RuntimeProviderFactory[] {
  return [
    () => { log.push("create:logger"); return Object.freeze({ type: "logger" }); },
    (dependencies) => { log.push("create:users"); return Object.freeze({ type: "users", logger: dependencies[0] }); },
    (dependencies) => { log.push("create:admin"); return Object.freeze({ type: "admin", logger: dependencies[0] }); },
    () => { log.push("create:user-only"); return Object.freeze({ type: "user-only" }); },
  ];
}

describe("generated artifacts and providers", () => {
  test("loads one exact generated module without scanning", async () => {
    let loads = 0;
    const loaded = await loadGeneratedApplication(() => { loads++; return generated; });
    expect(loaded.providerTable).toBe(generated.providerTable);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(loads).toBe(1);
    await expect(loadGeneratedApplication(Object.freeze({}) as RuntimeGeneratedApplication)).rejects.toBeInstanceOf(GeneratedArtifactError);
  });

  test("resolves Graph providers with one root fallback and preserves isolation", () => {
    const containers = new RuntimeProviderContainers(generated, factories());
    const users = containers.resolveGraph(0, 1) as { readonly logger: unknown };
    const admin = containers.resolveGraph(1, 2) as { readonly logger: unknown };
    expect(users.logger).toBe(admin.logger);
    expect(containers.resolveRoot(0)).toBe(users.logger);
    expect(() => containers.resolveGraph(1, 3)).toThrow(RuntimeProviderNotFoundError);
  });

  test("performs direct cached lookup for large provider tables", () => {
    const count = 5_000;
    const records = Array.from({ length: count }, (_, id) => Object.freeze({ id, nameId: id, graphId: -1, scope: "root", dependencyStart: 0, dependencyCount: 0 }));
    const artifact = Object.freeze({ ...generated, strings: Object.freeze(records.map((record) => String(record.id))), providerTable: Object.freeze(records), providerDependencies: Object.freeze([]) });
    const providers = new RuntimeProviderContainers(artifact, records.map((record) => () => record.id));
    expect(providers.resolveRoot(count - 1)).toBe(count - 1);
    expect(providers.resolveRoot(count - 1)).toBe(count - 1);
  });
});

describe("application lifecycle", () => {
  test("bootstraps enabled transports only and shuts down in lifecycle order", async () => {
    const events: string[] = [];
    let websocketLoads = 0;
    const http: RuntimeTransportAdapter = {
      kind: "http",
      start(context) {
        events.push("transport:start");
        expect("/users" in context.transport.routes).toBe(true);
        expect("user.changed" in context.transport.socketDispatchers[0]!).toBe(true);
        return Object.freeze({ listening: true });
      },
      stop() { events.push("transport:stop"); },
    };
    const runtime = await bootstrapApplication({
      generated: () => generated,
      providerFactories: factories(events),
      providerDisposers: Object.freeze({ 0: () => { events.push("dispose:logger"); } }),
      routeHandlers: [() => new Response("ok")],
      socketHandlers: [() => undefined, () => undefined],
      transportLoaders: {
        http: async () => { events.push("transport:load"); return http; },
        websocket: async () => { websocketLoads++; return { ...http, kind: "websocket" }; },
      },
      runtimeConfigLoader: async () => configuration,
      transportConfigLoader: async (transport) => { events.push(`config:${transport}`); return Object.freeze({}); },
      hooks: {
        onRuntimeStart: [() => { events.push("hook:start"); }],
        onRuntimeReady: [() => { events.push("hook:ready"); }],
        onRuntimeShutdown: [() => { events.push("hook:shutdown"); }],
      },
      installSignalHandlers: false,
    });
    expect(runtime.state).toBe(RuntimeState.RUNNING);
    expect(runtime.isTransportRunning("http")).toBe(true);
    expect(runtime.isTransportRunning("websocket")).toBe(false);
    expect(websocketLoads).toBe(0);
    expect(events).toEqual(["hook:start", "transport:load", "config:http", "transport:start", "hook:ready"]);
    runtime.providers!.resolveGraph(0, 1);
    await runtime.stop();
    expect(runtime.state).toBe(RuntimeState.STOPPED);
    expect(events.slice(-4)).toEqual(["create:users", "hook:shutdown", "transport:stop", "dispose:logger"]);
    await runtime.stop();
  });

  test("rejects invalid lifecycle transitions with typed errors", async () => {
    const runtime = createRuntime({
      generated,
      providerFactories: factories(),
      routeHandlers: [() => new Response()],
      socketHandlers: [() => undefined, () => undefined],
      runtimeConfigLoader: async () => Object.freeze({
        ...configuration,
        transports: Object.freeze(Object.fromEntries(Object.entries(configuration.transports).map(([name, value]) => [name, Object.freeze({ ...value, enabled: false })]))) as RuntimeConfig["transports"],
      }),
      installSignalHandlers: false,
    });
    await expect(runtime.stop()).rejects.toBeInstanceOf(InvalidRuntimeStateError);
    await runtime.bootstrap();
    await expect(runtime.bootstrap()).rejects.toBeInstanceOf(InvalidRuntimeStateError);
    await runtime.stop();
  });

  test("normalizes bootstrap failures into diagnostics and typed errors", async () => {
    const runtime = createRuntime({
      generated: Object.freeze({}) as RuntimeGeneratedApplication,
      providerFactories: [],
      routeHandlers: [],
      socketHandlers: [],
      runtimeConfigLoader: async () => configuration,
      installSignalHandlers: false,
    });
    await expect(runtime.bootstrap()).rejects.toBeInstanceOf(GeneratedArtifactError);
    expect(runtime.state).toBe(RuntimeState.STOPPED);
    expect(runtime.diagnostics[0]).toEqual(expect.objectContaining({ code: "WARBLER_RUNTIME_BOOTSTRAP", category: "error", phase: "loader" }));
  });
});
