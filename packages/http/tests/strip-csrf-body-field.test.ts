import { describe, expect, test } from "bun:test";
import { stripCsrfBodyField } from "../src/csrf";

describe("stripCsrfBodyField", () => {
  test("removes the field from an urlencoded body while preserving other fields and object identity", async () => {
    const body = new URLSearchParams({ email: "a@b.com", password: "x", _csrf: "abc.def" });
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    await stripCsrfBodyField(request, "_csrf", "form");

    const stripped = new URLSearchParams(await request.text());
    expect(stripped.get("_csrf")).toBeNull();
    expect(stripped.get("email")).toBe("a@b.com");
    expect(stripped.get("password")).toBe("x");
    // .blob()/.arrayBuffer() must agree with the stripped .text() view too.
    expect(await (await request.blob()).text()).toBe(await request.text());
  });

  test("removes the field from a JSON body while preserving other fields", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", _csrf: "abc.def" }),
    });

    await stripCsrfBodyField(request, "_csrf", "json");

    const parsed = (await request.json()) as Readonly<Record<string, unknown>>;
    expect(parsed).toEqual({ email: "a@b.com" });
  });

  test("is a no-op when the field is absent", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com" }),
    });

    await stripCsrfBodyField(request, "_csrf", "json");

    expect(await request.json()).toEqual({ email: "a@b.com" });
  });

  test("leaves multipart bodies untouched (not stripped)", async () => {
    const form = new FormData();
    form.set("email", "a@b.com");
    form.set("_csrf", "abc.def");
    const request = new Request("http://x/", { method: "POST", body: form });
    const originalContentType = request.headers.get("content-type");

    await stripCsrfBodyField(request, "_csrf", "form");

    const parsed = await request.formData();
    expect(parsed.get("_csrf")).toBe("abc.def");
    expect(request.headers.get("content-type")).toBe(originalContentType);
  });

  test("preserves request identity so Bun-attached properties like .params survive", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.com&_csrf=abc.def",
    });
    Object.defineProperty(request, "params", { value: { id: "42" }, configurable: true, enumerable: true });

    await stripCsrfBodyField(request, "_csrf", "form");

    expect((request as unknown as { params: unknown }).params).toEqual({ id: "42" });
    expect(request instanceof Request).toBe(true);
  });
});
