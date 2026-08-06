import { describe, expect, test } from "bun:test";
import { createInjectionToken, inject } from "@warbler/core";
import type { RuntimeConfig } from "@warbler/config";
import { startRuntime, type GeneratedApplicationBindings, type HttpRouteExecutor } from "../src";

const runtimeConfig: RuntimeConfig = Object.freeze({
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

const REQUEST_ITEM = createInjectionToken<RequestScopedItem>("REQUEST_ITEM");
class RequestScopedItem {
  readonly id: number;
  public constructor(id: number) { this.id = id; }
}
class ItemsController {
  list(): Response {
    const item = inject<RequestScopedItem>(REQUEST_ITEM);
    return new Response(String(item.id));
  }
}

interface Counters {
  nextId: number;
  created: number;
  disposed: number;
}

function application(counters: Counters, delayMs = 0): GeneratedApplicationBindings {
  return Object.freeze({
    application: Object.freeze({
      strings: Object.freeze([]), graphIds: Object.freeze({ ItemsGraph: 0 }),
      providerTable: Object.freeze([
        Object.freeze({ id: 0, nameId: 0, graphId: 0, scope: "request", dependencyStart: 0, dependencyCount: 0 }),
      ]),
      providerDependencies: Object.freeze([]),
      routeTable: Object.freeze([Object.freeze({
        id: 0, controllerId: 0, handlerId: 0, validatorId: -1,
        guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 0,
      })]),
      socketEventTable: Object.freeze([]),
      routeGuards: Object.freeze([]), routeMiddleware: Object.freeze([]),
      socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
    }),
    providers: Object.freeze([
      Object.freeze({
        id: 0, token: REQUEST_ITEM, scope: "request", graphId: 0, dependencyIds: Object.freeze([]),
        factory: async () => {
          if (delayMs > 0) await Bun.sleep(delayMs);
          const item = new RequestScopedItem(counters.nextId++);
          counters.created++;
          return item;
        },
        dispose: () => { counters.disposed++; },
      }),
    ]),
    controllers: Object.freeze([
      Object.freeze({ id: 0, graphId: 0, transport: "http", token: ItemsController, factory: () => new ItemsController() }),
    ]),
    handlers: Object.freeze([
      Object.freeze({ id: 0, controllerId: 0, invoke: (controller: ItemsController) => controller.list() }),
    ]),
    guards: Object.freeze([]),
    middleware: Object.freeze([]),
    validators: Object.freeze([]),
    http: Object.freeze({
      routes: Object.freeze([Object.freeze({ id: 0 })]),
      createRoutes: (execute: HttpRouteExecutor) => Object.freeze({ "/items": Object.freeze({ GET: (request: Request) => execute(0, request) }) }),
    }),
  });
}

async function startWithRoutes(counters: Counters, delayMs = 0) {
  let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
  const runtime = await startRuntime({
    application: application(counters, delayMs),
    runtimeConfig,
    transportLaunchers: [{
      kind: "http",
      start(input) {
        routes = (input.bindings as { readonly routes: typeof routes }).routes;
        return Object.freeze({});
      },
    }],
  });
  return { runtime, routes };
}

describe("request-scoped providers", () => {
  test("are not eagerly created at Runtime startup", async () => {
    const counters: Counters = { nextId: 0, created: 0, disposed: 0 };
    const { runtime } = await startWithRoutes(counters);
    expect(counters.created).toBe(0);
    await runtime.stop();
  });

  test("get a fresh instance per request, never cached across requests", async () => {
    const counters: Counters = { nextId: 0, created: 0, disposed: 0 };
    const { runtime, routes } = await startWithRoutes(counters);
    const first = await routes["/items"]!.GET!(new Request("http://localhost/items"));
    const second = await routes["/items"]!.GET!(new Request("http://localhost/items"));
    expect(await first.text()).toBe("0");
    expect(await second.text()).toBe("1");
    expect(counters.created).toBe(2);
    await runtime.stop();
  });

  test("disposes the request-scoped instance after each request, not deferred to Runtime shutdown", async () => {
    const counters: Counters = { nextId: 0, created: 0, disposed: 0 };
    const { runtime, routes } = await startWithRoutes(counters);
    await routes["/items"]!.GET!(new Request("http://localhost/items"));
    expect(counters.disposed).toBe(1);
    await runtime.stop();
  });

  test("does not corrupt request-scoped resolution under concurrent overlapping requests", async () => {
    const counters: Counters = { nextId: 0, created: 0, disposed: 0 };
    const { runtime, routes } = await startWithRoutes(counters, 20);
    const [first, second] = await Promise.all([
      routes["/items"]!.GET!(new Request("http://localhost/items")),
      routes["/items"]!.GET!(new Request("http://localhost/items")),
    ]);
    const [firstId, secondId] = await Promise.all([first.text(), second.text()]);
    expect(firstId).not.toBe(secondId);
    expect(new Set([firstId, secondId])).toEqual(new Set(["0", "1"]));
    expect(counters.created).toBe(2);
    await runtime.stop();
  });
});
