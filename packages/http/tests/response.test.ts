import { describe, expect, test } from "bun:test";
import {
  ArchiveRes,
  DownloadRes,
  EmptyRes,
  HtmlRes,
  ImageRes,
  JsonRes,
  PdfRes,
  RedirectRes,
  TextRes,
  redirect,
  redirectTo,
} from "../src";
import { configureNamedRouteRedirectResolver } from "../src/response";
import { buildNamedRouteTable, resolveRouteUrl, ViewRouteNotFoundError, ViewRouteParameterMissingError } from "../src/route";
import { runInViewRequestScope, type ViewRequestScope } from "../src/view";

describe("response helpers", () => {
  test("creates native typed responses without overwriting headers", async () => {
    expect(await JsonRes({ ok: true }).json()).toEqual({ ok: true });
    expect(HtmlRes("<p>x</p>").headers.get("content-type")).toContain("text/html");
    expect(TextRes("x", { headers: { "content-type": "custom/type" } }).headers.get("content-type")).toBe("custom/type");
    expect(EmptyRes().status).toBe(204);
  });

  test("guards redirect header injection", () => {
    expect(RedirectRes("/safe").headers.get("location")).toBe("/safe");
    expect(() => RedirectRes("/bad\r\nx: y")).toThrow();
  });

  test("redirect creates native empty redirect responses", async () => {
    for (const status of [301, 302, 303, 307, 308] as const) {
      const response = redirect("https://example.com/next", status);
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBe("https://example.com/next");
      expect(await response.text()).toBe("");
    }
    expect(redirect("/").status).toBe(302);
    expect(redirect("/login").headers.get("location")).toBe("/login");
  });

  test("redirectTo reuses the active canonical named-route resolver", () => {
    const table = buildNamedRouteTable([
      { name: "home", method: "GET", path: "/" },
      { name: "users.show", method: "GET", path: "/users/:id" },
      { name: "admin.login", method: "GET", path: "/admin/login" },
    ]);
    const scope = Object.freeze({
      request: new Request("http://example.com"),
      development: true,
      csrfFieldName: "_csrf",
      resolveAsset: (path: string) => path,
      resolveRoute: (name: string, params: readonly (string | number)[]) => resolveRouteUrl(table, name, params),
      issueCsrfToken: () => "token",
    }) satisfies ViewRequestScope;

    runInViewRequestScope(scope, () => {
      expect(redirectTo("home").headers.get("location")).toBe("/");
      const explicit = redirectTo("admin.login", 303);
      expect(explicit.status).toBe(303);
      expect(explicit.headers.get("location")).toBe("/admin/login");
      expect(redirectTo("users.show", ["a b/c"]).headers.get("location")).toBe("/users/a%20b%2Fc");
      expect(redirectTo("users.show", [5], 307).status).toBe(307);
      expect(() => redirectTo("missing")).toThrow(ViewRouteNotFoundError);
      expect(() => redirectTo("users.show")).toThrow(ViewRouteParameterMissingError);
    });
  });

  test("redirectTo can use the startup-configured named-route resolver outside a view scope", () => {
    const table = buildNamedRouteTable([
      { name: "users.show", method: "GET", path: "/users/:id" },
    ]);
    configureNamedRouteRedirectResolver((name, params, status) => redirect(resolveRouteUrl(table, name, params), status));

    const response = redirectTo("users.show", [7], 303);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/users/7");
  });

  test("creates lazy file, PDF, image, and archive responses", () => {
    const pdf = new Blob(["pdf"], { type: "application/pdf" });
    const image = new Blob(["png"], { type: "image/png" });
    expect(PdfRes(pdf, { filename: "report.pdf" }).headers.get("content-type")).toBe("application/pdf");
    expect(ImageRes(image, { filename: "image.png" }).headers.get("content-type")).toBe("image/png");
    expect(ArchiveRes(new Blob(["zip"]), { filename: "../bad.zip" }).headers.get("content-disposition")).not.toContain("../");
    expect(DownloadRes(pdf, { filename: "x.zip" }).headers.get("content-disposition")).toContain("attachment");
  });
});
