import { describe, expect, test } from "bun:test";
import { activateCompiledViews, createCompiledViewArtifact } from "@warbler/view";
import { runInViewRequestScope, view, type ViewRequestScope } from "../src/view";

function testScope(development: boolean, request = new Request("http://example.com/login", { method: "POST" })): ViewRequestScope {
  return Object.freeze({
    request,
    development,
    csrfFieldName: "_csrf",
    resolveAsset: (path: string) => path,
    resolveRoute: () => {
      throw new Error("no routes registered in this test");
    },
    issueCsrfToken: () => "should-never-appear-in-a-response",
  });
}

describe("view() error boundary", () => {
  test("an unknown helper call produces an organized development response, not a thrown exception", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { "auth.login": "{{ unknownHelper() }}" } }));
    const response = runInViewRequestScope(testScope(true), () => view("auth.login", {}));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toStartWith("WARBLER_VIEW_RENDER_ERROR");
    expect(body).toContain("Template: auth.login");
    expect(body).toContain("Reason:");
    expect(body).toContain("Request:");
    expect(body).toContain("POST /login");
  });

  test("an invalid expression is caught, not thrown, in development", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ )(( }}" } }));
    const response = runInViewRequestScope(testScope(true), () => view("home", {}));
    expect(response.status).toBe(500);
    expect((await response.text())).toStartWith("WARBLER_VIEW_RENDER_ERROR");
  });

  test("a missing template is caught, not thrown, in development", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "ok" } }));
    const response = runInViewRequestScope(testScope(true), () => view("does.not.exist", {}));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("Template: does.not.exist");
  });

  test("a reserved-name collision is caught, not thrown, in development", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "ok" } }));
    const response = runInViewRequestScope(testScope(true), () => view("home", { csrfField: "hijacked" }));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('Variable "csrfField" is reserved by Warbler.');
  });

  test("a route() failure is caught, not thrown, in development", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ route('nope') }}" } }));
    const response = runInViewRequestScope(testScope(true), () => view("home", {}));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("no routes registered in this test");
  });

  test("production responses are generic and never leak the template, expression, path, or token", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { "auth.login": "{{ unknownHelper() }}" } }));
    const response = runInViewRequestScope(testScope(false), () => view("auth.login", {}));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toBe("Internal Server Error\n\nThe requested view could not be rendered.");
    expect(body).not.toContain("auth.login");
    expect(body).not.toContain("unknownHelper");
    expect(body).not.toContain("/login");
    expect(body).not.toContain("should-never-appear-in-a-response");
    expect(body).not.toContain("WARBLER_VIEW_RENDER_ERROR");
  });

  test("no native Bun error page leaks: view() always returns a Response, never throws", () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ unknownHelper() }}" } }));
    expect(() => runInViewRequestScope(testScope(true), () => view("home", {}))).not.toThrow();
  });
});
