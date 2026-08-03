import { describe, expect, test } from "bun:test";
import { CsrfVerifier, csrfFailureResponse, type CsrfPolicy } from "../src/csrf";
import { HttpMethod } from "../src/route";

const POLICY: CsrfPolicy = Object.freeze({
  enabled: true,
  methods: Object.freeze([HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE]),
  headerName: "x-csrf-token",
  cookieName: "__Host-warbler-csrf",
  sources: Object.freeze(["header" as const]),
  strictSources: true,
});

describe("CSRF", () => {
  test("skips safe methods and verifies signed unsafe tokens", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    expect((await verifier.verify(new Request("http://x"), POLICY)).valid).toBe(true);
    const token = await verifier.sign("random-token");
    const valid = await verifier.verify(new Request("http://x", {
      method: "POST", headers: { "x-csrf-token": token },
    }), POLICY);
    expect(valid.valid).toBe(true);
  });

  test("rejects invalid tokens without leaking details", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    const result = await verifier.verify(new Request("http://x", {
      method: "POST", headers: { "x-csrf-token": "invalid.token" },
    }), POLICY);
    expect(result.valid).toBe(false);
    expect(await csrfFailureResponse().text()).toBe("CSRF validation failed.");
  });
});
