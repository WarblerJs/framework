import { describe, expect, test } from "bun:test";
import { NotFoundError } from "@warbler/core";
import { Console } from "@warbler/console";
import { createBunRouteHandler, createNotFoundFallback, type BunRouteHandlerOptions } from "../src/native";
import { RouteFlag } from "../src/compiled";

function baseOptions(handler: BunRouteHandlerOptions["handler"]): BunRouteHandlerOptions {
  return {
    handler,
    flags: 0,
    allowedHosts: ["example.com"],
    headers: { maxCount: 10, maxSize: 1000, maxNameSize: 100, maxValueSize: 500 },
    securityHeaders: { "x-content-type-options": "nosniff" },
    builtins: { asset: (path: string) => path, route: () => "" },
    development: false,
  };
}
const REQUEST = () => new Request("http://example.com", { headers: { host: "example.com" } });

describe("native request pipeline", () => {
  test("preserves a synchronous handler fast path", () => {
    const handler = createBunRouteHandler(baseOptions(() => new Response("ok")));
    const result = handler(REQUEST(), Object.create(null));
    expect(result).toBeInstanceOf(Response);
    expect(result).not.toBeInstanceOf(Promise);
  });

  test("provides a fallback-only final 404", async () => {
    const response = await createNotFoundFallback()(
      new Request("http://example.com/missing"),
      Object.create(null),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("quiet request logging selects a no-log success fast path", async () => {
    let requestLogs = 0;
    let responseLogs = 0;
    const originalRequest = Console.request.bind(Console);
    const originalResponse = Console.response.bind(Console);
    Console.request = ((input) => {
      requestLogs += 1;
      return originalRequest(input);
    }) as typeof Console.request;
    Console.response = ((request, input) => {
      responseLogs += 1;
      return originalResponse(request, input);
    }) as typeof Console.response;
    try {
      const handler = createBunRouteHandler({
        ...baseOptions(() => new Response("ok")),
        logging: { requests: false, errors: true },
      });
      const response = await handler(REQUEST(), Object.create(null));
      expect(response.status).toBe(200);
      expect(requestLogs).toBe(0);
      expect(responseLogs).toBe(0);
    } finally {
      Console.request = originalRequest as typeof Console.request;
      Console.response = originalResponse as typeof Console.response;
    }
  });

  test("HTTP profiling records aggregate stages without request logging", async () => {
    const stages: Record<string, number> = Object.create(null);
    let requests = 0;
    let requestLogs = 0;
    const originalRequest = Console.request.bind(Console);
    Console.request = ((input) => {
      requestLogs += 1;
      return originalRequest(input);
    }) as typeof Console.request;
    try {
      const handler = createBunRouteHandler({
        ...baseOptions(() => new Response("ok")),
        logging: { requests: false, errors: true },
        profiler: Object.freeze({
          enabled: true,
          record(stage: string): void { stages[stage] = (stages[stage] ?? 0) + 1; },
          recordRequest(): void { requests += 1; },
        }),
      });
      const response = await handler(REQUEST(), Object.create(null));
      expect(response.status).toBe(200);
      expect(requestLogs).toBe(0);
      expect(requests).toBe(1);
      expect(stages.contextPreparation).toBe(1);
      expect(stages.requestPreparation).toBe(1);
      expect(stages.generatedDispatch).toBe(1);
      expect(stages.securityHeaders).toBe(1);
    } finally {
      Console.request = originalRequest as typeof Console.request;
    }
  });

  describe("unified exception boundary", () => {
    test("a synchronous controller throw renders a Response, not a thrown error", async () => {
      const handler = createBunRouteHandler(baseOptions(() => {
        throw new NotFoundError("USER_NOT_FOUND", "User not found");
      }));
      const response = await handler(REQUEST(), Object.create(null));
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "USER_NOT_FOUND", message: "User not found" });
    });

    test("an async handler that rejects after its first await renders a Response, not a rejected promise", async () => {
      const handler = createBunRouteHandler(baseOptions(async () => {
        await Promise.resolve();
        throw new NotFoundError("USER_NOT_FOUND", "User not found");
      }));
      const result = handler(REQUEST(), Object.create(null));
      expect(result).toBeInstanceOf(Promise);
      const response = await result;
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "USER_NOT_FOUND", message: "User not found" });
    });

    test("an unexpected native Error is sanitized to a generic 500", async () => {
      const handler = createBunRouteHandler(baseOptions(async () => {
        throw new Error("unexpected failure with sensitive detail");
      }));
      const response = await handler(REQUEST(), Object.create(null));
      expect(response.status).toBe(500);
      const body = await response.json() as Readonly<Record<string, unknown>>;
      expect(body).toEqual({ code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error" });
    });

    test("a normal request after a failed one still succeeds (process/handler survives)", async () => {
      let attempt = 0;
      const handler = createBunRouteHandler(baseOptions(() => {
        attempt += 1;
        if (attempt === 1) throw new Error("first request fails");
        return new Response("ok");
      }));
      const first = await handler(REQUEST(), Object.create(null));
      expect(first.status).toBe(500);
      const second = await handler(REQUEST(), Object.create(null));
      expect(second.status).toBe(200);
      expect(await second.text()).toBe("ok");
    });
  });
});
