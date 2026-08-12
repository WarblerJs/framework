import { describe, expect, test } from "bun:test";
import {
  applySecurityHeaders,
  createSecurityHeaderApplicator,
  createSecurityHeaderTemplate,
  guardRequestSmuggling,
  validateRequestHost,
} from "../src/security";
import { FileRes, HtmlRes, HtmlStreamRes, JsonRes, RedirectRes, SseRes } from "../src/response";

const POLICY = Object.freeze({
  enabled: true,
  contentSecurityPolicy: "default-src 'self'",
  strictTransportSecurity: "max-age=1",
  frameOptions: "DENY" as const,
  contentTypeOptions: "nosniff" as const,
  referrerPolicy: "no-referrer",
  permissionsPolicy: "camera=()",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  crossOriginEmbedderPolicy: "require-corp",
});
const SECURITY_HEADER_EXPECTATIONS = Object.freeze({
  "content-security-policy": POLICY.contentSecurityPolicy,
  "strict-transport-security": POLICY.strictTransportSecurity,
  "x-frame-options": POLICY.frameOptions,
  "x-content-type-options": POLICY.contentTypeOptions,
  "referrer-policy": POLICY.referrerPolicy,
  "permissions-policy": POLICY.permissionsPolicy,
  "cross-origin-opener-policy": POLICY.crossOriginOpenerPolicy,
  "cross-origin-resource-policy": POLICY.crossOriginResourcePolicy,
  "cross-origin-embedder-policy": POLICY.crossOriginEmbedderPolicy,
});

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY_HEADER_EXPECTATIONS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.has("x-powered-by")).toBe(false);
}

describe("HTTP security", () => {
  test("precomputes and applies security headers", () => {
    const template = createSecurityHeaderTemplate(POLICY);
    const original = new Response("ok");
    const response = applySecurityHeaders(original, template);
    expect(Object.isFrozen(template)).toBe(true);
    expect(response).toBe(original);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.has("x-powered-by")).toBe(false);
  });

  test("binds a reusable security-header applicator without sharing response headers", async () => {
    const applyHeaders = createSecurityHeaderApplicator(createSecurityHeaderTemplate(POLICY));
    const [first, second] = await Promise.all([
      Promise.resolve(applyHeaders(new Response("a", { headers: { "set-cookie": "a=1" } }))),
      Promise.resolve(applyHeaders(new Response("b", { headers: { "set-cookie": "b=1" } }))),
    ]);
    expectSecurityHeaders(first);
    expectSecurityHeaders(second);
    expect(first.headers.get("set-cookie")).toBe("a=1");
    expect(second.headers.get("set-cookie")).toBe("b=1");
  });

  test("applies every configured security header to native response shapes", () => {
    const template = createSecurityHeaderTemplate(POLICY);
    const file = Bun.file(`${import.meta.dir}/security-headers.test.ts`, { type: "text/plain" });
    const responses = [
      new Response("ok"),
      JsonRes({ ok: true }),
      HtmlRes("<p>ok</p>"),
      RedirectRes("https://example.com/next"),
      new Response("Invalid request", { status: 400 }),
      new Response("Forbidden", { status: 403 }),
      HtmlStreamRes(new ReadableStream({ start(controller) { controller.enqueue("ok"); controller.close(); } })),
      SseRes((async function* events() { yield { data: "ok" }; })()),
      FileRes(file),
    ] as const;
    for (const response of responses) {
      expectSecurityHeaders(applySecurityHeaders(response, template));
    }
  });

  test("preserves response-specific headers, redirects, status, and cookies", () => {
    const template = createSecurityHeaderTemplate(POLICY);
    const response = applySecurityHeaders(new Response("ok", {
      status: 302,
      statusText: "Found",
      headers: {
        "content-type": "text/custom",
        location: "https://example.com",
        "set-cookie": "session=abc; HttpOnly",
      },
    }), template);
    expect(response.status).toBe(302);
    expect(response.statusText).toBe("Found");
    expect(response.headers.get("content-type")).toBe("text/custom");
    expect(response.headers.get("location")).toBe("https://example.com");
    expect(response.headers.get("set-cookie")).toBe("session=abc; HttpOnly");
    expectSecurityHeaders(response);
  });

  test("preserves header precedence and enforced x-powered-by removal", () => {
    const template = createSecurityHeaderTemplate({
      ...POLICY,
      contentSecurityPolicy: "default-src https:",
      frameOptions: "SAMEORIGIN",
      referrerPolicy: "same-origin",
    });
    const response = applySecurityHeaders(new Response("ok", {
      headers: {
        "content-security-policy": "script-src 'none'",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "x-powered-by": "Warbler",
      },
    }), template);
    expect(response.headers.get("content-security-policy")).toBe("script-src 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toBe(POLICY.strictTransportSecurity);
    expect(response.headers.has("x-powered-by")).toBe(false);
  });

  test("keeps concurrent responses isolated while applying precomputed headers", async () => {
    const template = createSecurityHeaderTemplate(POLICY);
    const first = new Response("a", {
      headers: {
        "content-security-policy": "default-src 'none'",
        "set-cookie": "first=1",
      },
    });
    const second = new Response("b", {
      headers: {
        "set-cookie": "second=1",
      },
    });
    const [firstResponse, secondResponse] = await Promise.all([
      Promise.resolve(applySecurityHeaders(first, template)),
      Promise.resolve(applySecurityHeaders(second, template)),
    ]);
    expect(firstResponse.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(secondResponse.headers.get("content-security-policy")).toBe(POLICY.contentSecurityPolicy);
    expect(firstResponse.headers.get("set-cookie")).toBe("first=1");
    expect(secondResponse.headers.get("set-cookie")).toBe("second=1");
    expect(firstResponse.headers.get("set-cookie")).not.toBe(secondResponse.headers.get("set-cookie"));
  });

  test("preserves existing fallback 404 security behavior", async () => {
    const response = await import("../src/native").then(({ createNotFoundFallback }) =>
      createNotFoundFallback()(new Request("http://example.com/missing"), Object.create(null)));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  test("validates hosts", () => {
    expect(validateRequestHost(new Request("http://example.com", { headers: { host: "example.com" } }), ["example.com"])).toBe("example.com");
    expect(() => validateRequestHost(new Request("http://x", { headers: { host: "evil.com" } }), ["example.com"])).toThrow();
  });

  test("rejects request smuggling framing", () => {
    expect(() => guardRequestSmuggling(new Request("http://x", { headers: { "content-length": "1", "transfer-encoding": "chunked" } }))).toThrow();
    expect(() => guardRequestSmuggling(new Request("http://x", { headers: [["content-length", "1"], ["content-length", "2"]] }))).toThrow();
  });
});
