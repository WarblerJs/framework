import { describe, expect, test } from "bun:test";
import { CsrfVerifier, csrfFailureResponse, type CsrfPolicy } from "../src/csrf";
import { HttpMethod } from "../src/route";

const POLICY: CsrfPolicy = Object.freeze({
  enabled: true,
  methods: Object.freeze([HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE]),
  headerName: "x-csrf-token",
  cookieName: "__Host-warbler-csrf",
  fieldName: "_csrf",
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

  test("signSync (used for synchronous token issuance) matches async sign() for the same token", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    expect(verifier.signSync("random-token")).toBe(await verifier.sign("random-token"));
  });

  test("a signSync-issued token passes verify()", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    const token = verifier.signSync(crypto.randomUUID());
    const result = await verifier.verify(new Request("http://x", {
      method: "POST", headers: { "x-csrf-token": token },
    }), POLICY);
    expect(result.valid).toBe(true);
  });
});

describe("CSRF form/json sources (what csrfField submits via a plain HTML form)", () => {
  const FORM_POLICY: CsrfPolicy = Object.freeze({ ...POLICY, sources: Object.freeze(["form" as const]) });
  const JSON_POLICY: CsrfPolicy = Object.freeze({ ...POLICY, sources: Object.freeze(["json" as const]) });

  test("accepts a token submitted as an urlencoded form field named after the configured field name", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    const token = verifier.signSync("form-token");
    const body = new URLSearchParams({ email: "a@b.com", _csrf: token });
    const request = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.toString().length) },
      body: body.toString(),
    });
    const result = await verifier.verify(request, FORM_POLICY);
    expect(result.valid).toBe(true);
    // Reading the CSRF field from a clone must never disturb the original body.
    const parsed = await request.formData();
    expect(parsed.get("email")).toBe("a@b.com");
  });

  test("accepts a token submitted as a JSON body field named after the configured field name", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    const token = verifier.signSync("json-token");
    const payload = JSON.stringify({ email: "a@b.com", _csrf: token });
    const request = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(payload.length) },
      body: payload,
    });
    const result = await verifier.verify(request, JSON_POLICY);
    expect(result.valid).toBe(true);
    expect((await request.json()) as Readonly<Record<string, unknown>>).toEqual({ email: "a@b.com", _csrf: token });
  });

  test("rejects a request declaring a body larger than the CSRF body-source ceiling, without buffering it", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    const request = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(2 * 1_048_576) },
      body: "_csrf=whatever",
    });
    const result = await verifier.verify(request, FORM_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
  });

  test("missing form field falls through to missing, not a thrown error", async () => {
    const verifier = await CsrfVerifier.create("a-secure-csrf-signing-secret-0001");
    const body = "email=a%40b.com";
    const request = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) },
      body,
    });
    const result = await verifier.verify(request, FORM_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
  });
});
