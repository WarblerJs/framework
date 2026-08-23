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
      hasDevNative: (request as { dev?: { native?: unknown } }).dev?.native instanceof Request,
      hasDevProperty: Object.prototype.hasOwnProperty.call(request, "dev"),
      hasBody: "body" in (request as object),
      headersIsHeaders: (request as { headers?: unknown }).headers instanceof Headers,
      cookiesIsCookieMap: (request as { cookies?: unknown }).cookies instanceof Bun.CookieMap,
      headers: (request as { headers?: unknown }).headers,
      cookies: (request as { cookies?: unknown }).cookies,
      message: (request as { message?: unknown }).message,
      metadata: (request as { metadata?: unknown }).metadata,
      context: (request as { context: unknown }).context,
      keys: Object.keys(request as Record<string, unknown>),
      frozen: Object.isFrozen(request),
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
        execute: (_request: unknown, context: { get: (key: string) => unknown }) => {
          context.get("user");
          return true;
        },
      }),
    ]),
    middleware: Object.freeze([
      Object.freeze({
        id: 0,
        execute: (request: unknown, context: { set: (key: string, value: unknown) => void }, next: (value?: unknown) => unknown) => {
          if (factory === "async") context.set("user", async () => { await Bun.sleep(1); return setValue; });
          else context.set("user", setValue);
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

  test("production AppRequest exposes only sanitized fields, not native Request, raw Headers, or raw cookies", async () => {
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: application({ id: "1" }),
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const response = await routes["/whoami"]!.GET!(new Request("http://localhost/whoami", { headers: { cookie: "session=abc" } }));
    const body = await response.json() as Record<string, unknown>;
    expect(body.hasNative).toBe(false);
    expect(body.hasDevNative).toBe(false);
    expect(body.hasDevProperty).toBe(false);
    expect(body.hasBody).toBe(true);
    expect(body.headersIsHeaders).toBe(false);
    expect(body.cookiesIsCookieMap).toBe(false);
    expect(body.headers).toEqual({});
    expect(body.cookies).toEqual({});
    expect(body.message).toEqual({});
    expect(body.metadata).toEqual({});
    expect(body.keys).toEqual(["body", "params", "query", "headers", "cookies", "message", "metadata", "context", "locale", "tr"]);
    expect(body.frozen).toBe(true);
    await runtime.stop();
  });

  test("development AppRequest exposes native Request only under dev.native", async () => {
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: application({ id: "1" }),
      runtimeConfig,
      development: true,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const response = await routes["/whoami"]!.GET!(new Request("http://localhost/whoami"));
    const body = await response.json() as Record<string, unknown>;
    expect(body.hasNative).toBe(false);
    expect(body.hasDevNative).toBe(true);
    expect(body.hasDevProperty).toBe(true);
    expect(body.keys).toEqual(["dev", "body", "params", "query", "headers", "cookies", "message", "metadata", "context", "locale", "tr"]);
    await runtime.stop();
  });

  test("unvalidated AppRequest does not parse or expose raw cookies", async () => {
    let cookieHeaderReads = 0;
    class LazyCookieController {
      show(request: unknown): Response {
        const keys = Object.keys(request as Record<string, unknown>);
        const beforeAccess = cookieHeaderReads;
        const first = (request as { readonly cookies: Readonly<Record<string, unknown>> }).cookies;
        const second = (request as { readonly cookies: Readonly<Record<string, unknown>> }).cookies;
        return Response.json({
          keys,
          beforeAccess,
          afterAccess: cookieHeaderReads,
          sameMap: first === second,
          session: first.session,
        });
      }
    }
    const app: GeneratedApplicationBindings = Object.freeze({
      application: Object.freeze({
        strings: Object.freeze([]), graphIds: Object.freeze({ AppGraph: 0 }),
        providerTable: Object.freeze([]), providerDependencies: Object.freeze([]),
        routeTable: Object.freeze([Object.freeze({
          id: 0, controllerId: 0, handlerId: 0, validatorId: -1,
          guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 0,
        })]),
        socketEventTable: Object.freeze([]),
        routeGuards: Object.freeze([]), routeMiddleware: Object.freeze([]),
        socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
      }),
      providers: Object.freeze([]),
      controllers: Object.freeze([
        Object.freeze({ id: 0, graphId: 0, transport: "http", token: LazyCookieController, factory: () => new LazyCookieController() }),
      ]),
      handlers: Object.freeze([
        Object.freeze({ id: 0, controllerId: 0, parameterCount: 1, invoke: (controller: LazyCookieController, request: unknown) => controller.show(request) }),
      ]),
      guards: Object.freeze([]),
      middleware: Object.freeze([]),
      validators: Object.freeze([]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 })]),
        createRoutes: (execute: HttpRouteExecutor) =>
          Object.freeze({ "/lazy-cookie": Object.freeze({ GET: (request: Request) => execute(0, request) }) }),
      }),
    });
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: app,
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const request = new Request("http://localhost/lazy-cookie", { headers: { cookie: "session=abc" } });
    const read = request.headers.get.bind(request.headers);
    Object.defineProperty(request.headers, "get", {
      value: (name: string): string | null => {
        if (name.toLowerCase() === "cookie") cookieHeaderReads++;
        return read(name);
      },
    });
    const response = await routes["/lazy-cookie"]!.GET!(request);
    const body = await response.json() as Record<string, unknown>;
    expect(body.keys).toEqual(["body", "params", "query", "headers", "cookies", "message", "metadata", "context", "locale", "tr"]);
    expect(body.beforeAccess).toBe(0);
    expect(body.afterAccess).toBe(0);
    expect(body.sameMap).toBe(true);
    expect(body.session).toBeUndefined();
    await runtime.stop();
  });

  test("validated AppRequest binds every successful source and omits undeclared transport fields", async () => {
    class ValidatedController {
      show(request: unknown): Response {
        const req = request as Readonly<Record<string, unknown>>;
        return Response.json({
          hasNative: req.native instanceof Request,
          hasDevNative: (req.dev as { native?: unknown } | undefined)?.native instanceof Request,
          body: req.body,
          params: req.params,
          query: req.query,
          headers: req.headers,
          cookies: req.cookies,
          message: req.message,
          metadata: req.metadata,
        });
      }
    }
    const validated = Object.freeze({
      valid: true,
      value: Object.freeze({ message_content: "hello >>---added" }),
      query: Object.freeze({ id: 53 }),
      path: Object.freeze({ id: 57 }),
      headers: Object.freeze({ "x-language": "en" }),
      cookies: Object.freeze({ session: "abc" }),
      message: Object.freeze({ event: "created" }),
      metadata: Object.freeze({ traceId: "trace-1" }),
    });
    const app: GeneratedApplicationBindings = Object.freeze({
      application: Object.freeze({
        strings: Object.freeze([]), graphIds: Object.freeze({ AppGraph: 0 }),
        providerTable: Object.freeze([]), providerDependencies: Object.freeze([]),
        routeTable: Object.freeze([Object.freeze({
          id: 0, controllerId: 0, handlerId: 0, validatorId: 0,
          guardStart: 0, guardCount: 0, middlewareStart: 0, middlewareCount: 0,
        })]),
        socketEventTable: Object.freeze([]),
        routeGuards: Object.freeze([]), routeMiddleware: Object.freeze([]),
        socketGuards: Object.freeze([]), socketMiddleware: Object.freeze([]),
      }),
      providers: Object.freeze([]),
      controllers: Object.freeze([
        Object.freeze({ id: 0, graphId: 0, transport: "http", token: ValidatedController, factory: () => new ValidatedController() }),
      ]),
      handlers: Object.freeze([
        Object.freeze({ id: 0, controllerId: 0, parameterCount: 1, invoke: (controller: ValidatedController, request: unknown) => controller.show(request) }),
      ]),
      guards: Object.freeze([]),
      middleware: Object.freeze([]),
      validators: Object.freeze([Object.freeze({ id: 0, flags: 127, validate: () => validated })]),
      http: Object.freeze({
        routes: Object.freeze([Object.freeze({ id: 0 })]),
        createRoutes: (execute: HttpRouteExecutor) =>
          Object.freeze({
            "/validated": Object.freeze({
              POST: (request: Request) => execute(0, request, Object.freeze({
                value: Object.freeze({ raw: "body" }),
                query: Object.freeze({ raw: "query" }),
                path: Object.freeze({ raw: "path" }),
                headers: Object.freeze({ "content-type": "application/json", "x-language": "en", "x-csrf-token": "secret" }),
                cookies: Object.freeze({ session: "abc", raw: "cookie" }),
                message: Object.freeze({ raw: "message" }),
                metadata: Object.freeze({ raw: "metadata" }),
              })),
            }),
          }),
      }),
    });
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const runtime = await startRuntime({
      application: app,
      runtimeConfig,
      transportLaunchers: [{ kind: "http", start(input) { routes = (input.bindings as { readonly routes: typeof routes }).routes; return Object.freeze({}); } }],
      transportConfigLoader: async (kind) => Object.freeze({ kind }),
    });
    const response = await routes["/validated"]!.POST!(new Request("http://localhost/validated"));
    const body = await response.json() as Record<string, unknown>;
    expect(body.hasNative).toBe(false);
    expect(body.hasDevNative).toBe(false);
    expect(body.body).toEqual({ message_content: "hello >>---added" });
    expect(body.params).toEqual({ id: 57 });
    expect(body.query).toEqual({ id: 53 });
    expect(body.headers).toEqual({ "x-language": "en" });
    expect(body.cookies).toEqual({ session: "abc" });
    expect(body.message).toEqual({ event: "created" });
    expect(body.metadata).toEqual({ traceId: "trace-1" });
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
