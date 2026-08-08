import { describe, expect, test } from "bun:test";
import { createBunRouteHandler, createNotFoundFallback } from "../src/native";
import { RouteFlag } from "../src/compiled";

describe("native request pipeline", () => {
  test("preserves a synchronous handler fast path", () => {
    const handler = createBunRouteHandler({
      handler: () => new Response("ok"),
      flags: 0,
      allowedHosts: ["example.com"],
      headers: { maxCount: 10, maxSize: 1000, maxNameSize: 100, maxValueSize: 500 },
      securityHeaders: { "x-content-type-options": "nosniff" },
      builtins: { asset: (path: string) => path, route: () => "" },
      development: false,
    });
    const result = handler(
      new Request("http://example.com", { headers: { host: "example.com" } }),
      Object.create(null),
    );
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
});
