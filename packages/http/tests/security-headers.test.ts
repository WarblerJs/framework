import { describe, expect, test } from "bun:test";
import {
  applySecurityHeaders,
  createSecurityHeaderTemplate,
  guardRequestSmuggling,
  validateRequestHost,
} from "../src/security";

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

describe("HTTP security", () => {
  test("precomputes and applies security headers", () => {
    const template = createSecurityHeaderTemplate(POLICY);
    const response = applySecurityHeaders(new Response("ok"), template);
    expect(Object.isFrozen(template)).toBe(true);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.has("x-powered-by")).toBe(false);
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
