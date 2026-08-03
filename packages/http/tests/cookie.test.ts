import { describe, expect, test } from "bun:test";
import { SignedCookie, parseCookies, serializeCookie } from "../src/cookies";

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
