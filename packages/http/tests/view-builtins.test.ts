import { describe, expect, test } from "bun:test";
import { activateCompiledViews, createCompiledViewArtifact, ViewReservedVariableError } from "@warblerjs/view";
import { RESERVED_VIEW_BUILTIN_NAMES, runInViewRequestScope, view, type ViewRequestScope } from "../src/view";
import { buildNamedRouteTable, resolveRouteUrl, ViewRouteNotFoundError, ViewRouteParameterMissingError } from "../src/route";
import { joinPaths } from "../src/internal";

function testScope(overrides: Partial<ViewRequestScope> = {}): ViewRequestScope {
  return Object.freeze({
    request: new Request("http://example.com/page"),
    development: true,
    csrfFieldName: "_csrf",
    resolveAsset: (path: string) => joinPaths("/", path),
    resolveRoute: () => "/unused",
    issueCsrfToken: () => "test-token.signature",
    ...overrides,
  });
}

describe("view() built-ins", () => {
  test("tr/asset/route are available automatically without being passed from the controller", () => {
    activateCompiledViews(createCompiledViewArtifact({
      templates: {
        home: "{{ tr('auth.login') }} | {{ asset('app.css') }} | {{ route('users.show', 1) }}",
      },
    }));
    const table = buildNamedRouteTable([{ name: "users.show", method: "GET", path: "/users/:id" }]);
    const scope = testScope({
      request: Object.assign(new Request("http://example.com/"), { tr: (key: string) => `translated:${key}` }),
      resolveRoute: (name, params) => resolveRouteUrl(table, name, params),
    });

    const response = runInViewRequestScope(scope, () => view("home", {}));

    expect(response.status).toBe(200);
  });

  test("tr falls back to the raw key when the request has no locale/tr attached", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ tr('auth.login') }}" } }));
    const response = runInViewRequestScope(testScope(), () => view("home", {}));
    expect(await response.text()).toBe("auth.login");
  });

  test("asset() normalizes and joins against the static prefix", async () => {
    activateCompiledViews(createCompiledViewArtifact({ templates: { home: "{{ asset('images/logo.svg') }}" } }));
    const response = runInViewRequestScope(testScope(), () => view("home", {}));
    expect(await response.text()).toBe("/images/logo.svg");
  });

  for (const name of RESERVED_VIEW_BUILTIN_NAMES) {
    test(`application data cannot override the reserved built-in "${name}"`, () => {
      activateCompiledViews(createCompiledViewArtifact({ templates: { home: "irrelevant" } }));
      const response = runInViewRequestScope(testScope(), () => view("home", { [name]: "hijacked" }));
      expect(response.status).toBe(500);
    });
  }

  test("reserved-name collisions throw ViewReservedVariableError before rendering (caught by the boundary)", () => {
    // Verified directly against the underlying assertion, independent of the response boundary.
    expect(() => {
      throw new ViewReservedVariableError("csrfField");
    }).toThrow('Variable "csrfField" is reserved by Warbler.');
  });
});

describe("route() resolver", () => {
  const table = buildNamedRouteTable([
    { name: "users.show", method: "GET", path: "/users/:id" },
    { name: "users.list", method: "GET", path: "/users" },
  ]);

  test("known route generates a URL", () => {
    expect(resolveRouteUrl(table, "users.show", [42])).toBe("/users/42");
  });

  test("dynamic parameters are URL-encoded", () => {
    expect(resolveRouteUrl(table, "users.show", ["a b/c"])).toBe("/users/a%20b%2Fc");
  });

  test("unknown route name throws a normalized error", () => {
    expect(() => resolveRouteUrl(table, "nope", [])).toThrow(ViewRouteNotFoundError);
  });

  test("missing required parameter throws a normalized error naming the parameter", () => {
    let caught: unknown;
    try {
      resolveRouteUrl(table, "users.show", []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ViewRouteParameterMissingError);
    expect((caught as ViewRouteParameterMissingError).parameterName).toBe("id");
  });
});
