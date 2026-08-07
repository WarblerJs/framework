import { describe, expect, test } from "bun:test";
import {
  SignedCookie, assertCookieHeaderWithinLimits, cookieMapRecord, parseCookies,
  requestCookieMap, serializeCookie,
} from "../src/cookies";

describe("cookies", () => {
  test("parses and serializes secure cookies", () => {
    expect(parseCookies("a=1; b=hello%20world")).toEqual({ a: "1", b: "hello world" });
    expect(serializeCookie("__Host-token", "value", { secure: true, path: "/", httpOnly: true, sameSite: "Lax" })).toContain("Secure");
  });

  test("rejects invalid host-prefix combinations", () => {
    expect(() => serializeCookie("__Host-token", "x", { path: "/" })).toThrow();
  });

  test("signs and verifies with one cached key", async () => {
    const signer = await SignedCookie.create("a-secure-cookie-signing-secret-32");
    const signed = await signer.sign("value");
    expect(await signer.verify(signed)).toBe("value");
    expect(await signer.verify(`${signed}x`)).toBeUndefined();
  });
});

describe("requestCookieMap (Bun.CookieMap integration)", () => {
  test("constructs a CookieMap from a plain Request's Cookie header", () => {
    const request = new Request("https://example.com", { headers: { cookie: "a=1; b=2" } });
    const cookies = requestCookieMap(request);
    expect(cookies).toBeInstanceOf(Bun.CookieMap);
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("b")).toBe("2");
  });

  test("reuses BunRequest.cookies identity when already present", () => {
    const existing = new Bun.CookieMap("a=1");
    const bunLike = new Request("https://example.com") as Request & { readonly cookies: Bun.CookieMap };
    Object.defineProperty(bunLike, "cookies", { value: existing });
    expect(requestCookieMap(bunLike)).toBe(existing);
  });

  test("does not throw on an individually malformed cookie pair (Bun.CookieMap parses leniently)", () => {
    const request = new Request("https://example.com", { headers: { cookie: "not-a-pair; a=1" } });
    expect(() => requestCookieMap(request)).not.toThrow();
    expect(requestCookieMap(request).get("a")).toBe("1");
  });

  test("still rejects an oversized Cookie header before construction", () => {
    const request = new Request("https://example.com", { headers: { cookie: `a=${"x".repeat(9000)}` } });
    expect(() => requestCookieMap(request)).toThrow();
  });

  test("still rejects a cookie-flooded header before construction", () => {
    const header = Array.from({ length: 60 }, (_, i) => `c${i}=v`).join("; ");
    const request = new Request("https://example.com", { headers: { cookie: header } });
    expect(() => requestCookieMap(request)).toThrow();
  });

  test("assertCookieHeaderWithinLimits is a no-op for a null or empty header", () => {
    expect(() => assertCookieHeaderWithinLimits(null)).not.toThrow();
    expect(() => assertCookieHeaderWithinLimits("")).not.toThrow();
  });

  test("cookieMapRecord produces a plain record for validator input", () => {
    const map = new Bun.CookieMap("session=abc; theme=dark");
    expect(cookieMapRecord(map)).toEqual({ session: "abc", theme: "dark" });
  });
});
