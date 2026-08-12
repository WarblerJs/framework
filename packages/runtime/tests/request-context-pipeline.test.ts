import { describe, expect, test } from "bun:test";
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

class WhoAmIController {
  show(request: unknown): Response {
    return Response.json({
      hasNative: (request as { native?: unknown }).native instanceof Request,
      hasBody: "body" in (request as object),
      headersIsHeaders: (request as { headers?: unknown }).headers instanceof Headers,
      cookiesIsCookieMap: (request as { cookies?: unknown }).cookies instanceof Bun.CookieMap,
      sessionCookie: (request as { cookies: Bun.CookieMap }).cookies.get("session"),
      context: (request as { context: unknown }).context,
    });
  }
}
class MinimalController {
  bench(): Response { return new Response("OK"); }
}

/** Simulates the compiler always calling `prepareHttpValidationInput` (Phase 4), even for a route with no validator. */
function emptyValidationInput(): Readonly<Record<string, unknown>> { return Object.freeze({}); }

function application(setValue: unknown, factory: "sync" | "async" = "sync"): GeneratedApplicationBindings {
  return Object.freeze({
    application: Object.freeze({
      strings: Object.freeze([]), graphIds: Object.freeze({ AppGraph: 0 }),
      providerTable: Object.freeze([]), providerDependencies: Object.freeze([]),
      routeTable: Object.freeze([Object.freeze({
        id: 0, controllerId: 0, handlerId: 0, validatorId: -1,
        guardStart: 0, guardCount: 1, middlewareStart: 0, middlewareCount: 1,
      })]),
      socketEventTable: Object.freeze([]),
      routeGuards: Object.freeze([0]), routeMiddleware: Object.freeze([0]),
      socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
    }),
    providers: Object.freeze([]),
    controllers: Object.freeze([
      Object.freeze({ id: 0, graphId: 0, transport: "http", token: WhoAmIController, factory: () => new WhoAmIController() }),
    ]),
    handlers: Object.freeze([
      Object.freeze({ id: 0, controllerId: 0, invoke: (controller: WhoAmIController, request: unknown) => controller.show(request) }),
    ]),
    guards: Object.freeze([
      Object.freeze({
        id: 0,
        execute: (_request: unknown, context: { set: (key: string, value: unknown) => void }) => {
          if (factory === "async") context.set("user", async () => { await Bun.sleep(1); return setValue; });
          else context.set("user", setValue);
          return true;
        },
      }),
    ]),
    middleware: Object.freeze([
      Object.freeze({
        id: 0,
        execute: (request: unknown, context: { get: (key: string) => unknown }, next: (value?: unknown) => unknown) => {
          context.get("user"); // reads back what the guard set — proves middleware can build on prior pipeline state
          return next(request);
        },
      }),
    ]),
    validators: Object.freeze([]),
    http: Object.freeze({
      routes: Object.freeze([Object.freeze({ id: 0 })]),
      createRoutes: (execute: HttpRouteExecutor) =>
        Object.freeze({ "/whoami": Object.freeze({ GET: (request: Request) => execute(0, request, emptyValidationInput()) }) }),
    }),
  });
}

describe("request context pipeline", () => {
  test("minimal zero-argument routes bypass AppRequest and request context construction", async () => {
    let inputCount = -1;
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const app: GeneratedApplicationBindings = Object.freeze({
      application: Object.freeze({
        strings: Object.freeze([]), graphIds: Object.freeze({ AppGraph: 0 }),
        providerTable: Object.freeze([]), providerDependencies: Object.freeze([]),
        routeTable: Object.freeze([Object.freeze({
          id: 0, controllerId: 0, handlerId: 0, validatorId: -1,
          guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 0, flags: 0,
        })]),
        socketEventTable: Object.freeze([]),
        routeGuards: Object.freeze([]), routeMiddleware: Object.freeze([]),
        socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
      }),
      providers: Object.freeze([]),
      controllers: Object.freeze([
        Object.freeze({ id: 0, graphId: 0, transport: "http", token: MinimalController, factory: () => new MinimalController() }),
      ]),
      handlers: Object.freeze([
        Object.freeze({
          id: 0, controllerId: 0, parameterCount: 0,
          invoke: (controller: MinimalController, ...input: readonly unknown[]) => {
            inputCount = input.length;
            return controller.bench();
          },
        }),
      ]),
      guards: Object.freeze([]),
      middleware: Object.freeze([]),
      validators: Object.freeze([]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 })]),
        createRoutes: (execute: HttpRouteExecutor) =>
          Object.freeze({ "/bench": Object.freeze({ GET: (request: Request) => execute(0, request) }) }),
      }),
    });
    const runtime = await startRuntime({
      application: app,
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const result = routes["/bench"]!.GET!(new Request("http://localhost/bench"));
    expect(result).toBeInstanceOf(Response);
    expect(await (result as Response).text()).toBe("OK");
    expect(inputCount).toBe(0);
    await runtime.stop();
  });

  test("every route gets a real AppRequest — even with no validator — with real Headers and a real Bun.CookieMap", async () => {
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: application({ id: "1" }),
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const response = await routes["/whoami"]!.GET!(new Request("http://localhost/whoami", { headers: { cookie: "session=abc" } }));
    const body = await response.json() as Record<string, unknown>;
    expect(body.hasNative).toBe(true);
    expect(body.hasBody).toBe(true);
    expect(body.headersIsHeaders).toBe(true);
    expect(body.cookiesIsCookieMap).toBe(true);
    expect(body.sessionCookie).toBe("abc");
    await runtime.stop();
  });

  test("a value a guard sets via context.set() is visible on req.context in the handler", async () => {
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: application({ id: "42", email: "a@b.com" }),
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const response = await routes["/whoami"]!.GET!(new Request("http://localhost/whoami"));
    const body = await response.json() as { readonly context: { readonly user: unknown } };
    expect(body.context.user).toEqual({ id: "42", email: "a@b.com" });
    await runtime.stop();
  });

  test("an async factory passed to context.set() is resolved before the handler runs", async () => {
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: application({ id: "async-1" }, "async"),
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const response = await routes["/whoami"]!.GET!(new Request("http://localhost/whoami"));
    const body = await response.json() as { readonly context: { readonly user: unknown } };
    expect(body.context.user).toEqual({ id: "async-1" });
    await runtime.stop();
  });

  test("does not leak request context state across concurrent overlapping requests", async () => {
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: application({ id: "shared" }, "async"),
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const [first, second] = await Promise.all([
      routes["/whoami"]!.GET!(new Request("http://localhost/whoami")),
      routes["/whoami"]!.GET!(new Request("http://localhost/whoami")),
    ]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]) as [
      { readonly context: { readonly user: unknown } }, { readonly context: { readonly user: unknown } },
    ];
    expect(firstBody.context.user).toEqual({ id: "shared" });
    expect(secondBody.context.user).toEqual({ id: "shared" });
    await runtime.stop();
  });
});
