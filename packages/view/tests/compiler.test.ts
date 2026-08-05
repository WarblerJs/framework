import { describe, expect, test } from "bun:test";
import {
  activateCompiledViews,
  compileViewProject,
  createViewDevelopmentRoutes,
  View,
} from "../src";

const createProject = async (
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const root = `/tmp/warbler-view-${crypto.randomUUID()}`;
  for (const [path, value] of Object.entries(files)) {
    await Bun.write(`${root}/${path}`, value);
  }
  return root;
};

describe("View compiler", () => {
  test("creates deterministic immutable dependency artifacts", async () => {
    const root = await createProject({
      "resources/views/layouts/main.html": "<html>@yield('content')</html>",
      "resources/views/partials/nav.html": "<nav>{{ title }}</nav>",
      "resources/views/home/index.html":
        "@extends('layouts.main')@section('content') {@import('partials.nav')}",
    });
    const first = await compileViewProject({ projectRoot: root });
    const second = await compileViewProject({ projectRoot: root });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.artifact.dependencies["home.index"]).toEqual([
      "layouts.main",
      "partials.nav",
    ]);
    expect(first.artifact.dependents["layouts.main"]).toEqual(["home.index"]);
    expect(Object.isFrozen(first.artifact)).toBe(true);
    expect(Object.isFrozen(first.artifact.ast["home.index"]?.body)).toBe(true);
  });

  test("compiles only transitive dependents after an isolated change", async () => {
    const root = await createProject({
      "resources/views/layout.html": "@yield('content')",
      "resources/views/page.html": "@extends('layout')@section('content') {Page}",
      "resources/views/other.html": "Other",
    });
    const first = await compileViewProject({ projectRoot: root });
    await Bun.write(`${root}/resources/views/layout.html`, "<main>@yield('content')</main>");
    const second = await compileViewProject({
      projectRoot: root,
      previous: first.artifact,
      changedTemplates: ["resources/views/layout.html"],
    });
    expect(second.compiled).toEqual(["layout", "page"]);
    expect(second.compiled).not.toContain("other");
  });

  test("rejects circular and missing dependencies before Runtime", async () => {
    const circular = await createProject({
      "resources/views/a.html": "@import('b')",
      "resources/views/b.html": "@import('a')",
    });
    await expect(compileViewProject({ projectRoot: circular })).rejects.toThrow(
      "Circular view dependency",
    );
    const missing = await createProject({
      "resources/views/a.html": "@import('missing')",
    });
    await expect(compileViewProject({ projectRoot: missing })).rejects.toMatchObject({
      code: "VIEW1001",
    });
  });

  test("renders synchronously without parsing or filesystem access", async () => {
    const root = await createProject({
      "resources/views/page.html": "{{ value }}|{!! value !!}",
    });
    const compiled = await compileViewProject({ projectRoot: root });
    activateCompiledViews(compiled.artifact);
    const response = View("page", { value: "<b>safe</b>" });
    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toBe("&lt;b&gt;safe&lt;/b&gt;|<b>safe</b>");
  });

  test("rejects prototype-property expression traversal", async () => {
    const root = await createProject({
      "resources/views/page.html": "{{ value.constructor.name }}",
    });
    const compiled = await compileViewProject({ projectRoot: root });
    activateCompiledViews(compiled.artifact);
    expect(() => View("page", { value: "unsafe" })).toThrow(
      "Failed to evaluate template expression",
    );
  });

  test("mounts one real development channel and injects one client", async () => {
    const root = await createProject({
      "resources/views/page.html": "<body>Page</body>",
    });
    const compiled = await compileViewProject({
      projectRoot: root,
      config: { hotReload: true },
    });
    activateCompiledViews(compiled.artifact);
    const html = await View("page").text();
    expect(html.match(/data-warbler-view/gu)?.length).toBe(1);
    const routes = createViewDevelopmentRoutes();
    expect(routes["/__warbler/view/events"]?.GET).toBeFunction();
    expect(routes["/__warbler/view/client.js"]?.GET).toBeFunction();
  });
});
