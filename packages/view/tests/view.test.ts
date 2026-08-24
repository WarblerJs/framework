import { describe, expect, test } from "bun:test";
import {
  createCompiledViewArtifact,
  renderCompiledView,
} from "../src";

describe("@warblerjs/view", () => {
  test("preserves default layout metadata", () => {
    const artifact = createCompiledViewArtifact({
      defaultLayout: "layouts.main",
      templates: {
        home: "<h1>Home</h1>",
      },
    });

    expect(artifact.defaultLayout).toBe("layouts.main");
  });

  test("supports nested properties and array indexes", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        "home.index":
          "<h1>{{ users[0].name }}</h1>",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home.index",
      data: {
        users: [
          {
            id: 1,
            name: "Noah",
            uuid: "7b9f0c27-55e6-4c1c-b5d2-1fb40014fe94",
          },
        ],
      },
    });

    expect(html).toBe("<h1>Noah</h1>");
  });

  test("supports @if and @else", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        page: `
@if (users.length > 0) {
  <p>{{ users.length }} users</p>
} @else {
  <p>No users</p>
}`,
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "page",
      data: {
        users: [{ name: "Noah" }],
      },
    });

    expect(html).toContain("1 users");
  });

  test("supports @for with index", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        page: `
<ul>
@for (user, index of users) {
  <li>{{ index }}: {{ user.name }}</li>
}
</ul>`,
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "page",
      data: {
        users: [
          { name: "Noah" },
          { name: "Emma" },
        ],
      },
    });

    expect(html).toContain("0: Noah");
    expect(html).toContain("1: Emma");
  });

  test("supports layouts and sections", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        "layouts.main":
          "<html><body>@yield('content')</body></html>",
        home: `
@extends('layouts.main')
@section('content') {
  <h1>{{ title }}</h1>
}`,
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
      data: { title: "Warbler" },
    });

    expect(html).toContain("<html>");
    expect(html).toContain("<h1>Warbler</h1>");
  });

  test("passes render data into an extended layout", () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        "layouts.main":
          "<html><head><title>{{ title }}</title></head><body>@yield('content')</body></html>",
        home: "@extends('layouts.main')@section('content') {<h1>{{ title }}</h1>}",
      },
    });

    const html = renderCompiledView({
      artifact,
      name: "home",
      data: { title: "Warbler" },
    });

    expect(html).toContain("<title>Warbler</title>");
    expect(html).toContain("<h1>Warbler</h1>");
  });

  test("wraps views in the default layout", async () => {
    const artifact = createCompiledViewArtifact({
      defaultLayout: "main",
      layouts: {
        main: "<main>{{content}}</main>",
      },
      templates: {
        home: "<h1>{{ t:home.title }}</h1>",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
      translate: (key) => key === "home.title" ? "Home" : key,
    });

    expect(html).toBe("<main><h1>Home</h1></main>");
  });

  test("does not apply default layout to views with explicit layouts", async () => {
    const artifact = createCompiledViewArtifact({
      defaultLayout: "shell",
      layouts: {
        main: "<main>@yield('content')</main>",
        shell: "<section>{{content}}</section>",
      },
      templates: {
        home: `
@extends('main')
@section('content') {
  <h1>Home</h1>
}`,
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
    });

    expect(html).toContain("<main>");
    expect(html).not.toContain("<section>");
  });

  test("does not apply default layout to imported templates", async () => {
    const artifact = createCompiledViewArtifact({
      defaultLayout: "main",
      layouts: {
        main: "<main>{{content}}</main>",
      },
      partials: {
        nav: "<nav>Nav</nav>",
      },
      templates: {
        home: "@import('nav')<h1>Home</h1>",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
    });

    expect(html).toBe("<main><nav>Nav</nav><h1>Home</h1></main>");
  });

  test("escapes regular expressions and allows raw output", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        page: "{{ html }}|{!! html !!}",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "page",
      data: { html: "<strong>Hello</strong>" },
    });

    expect(html).toBe(
      "&lt;strong&gt;Hello&lt;/strong&gt;|<strong>Hello</strong>",
    );
  });
});

test("reports missing template variables with render context", async () => {
  const artifact = createCompiledViewArtifact({
    templates: {
      page: "<h1>{{ user.name }}</h1>",
    },
  });

  try {
    await renderCompiledView({
      artifact,
      name: "page",
      data: { title: "Home" },
    });
    throw new Error("Expected template expression failure.");
  } catch (error) {
    expect(error).toMatchObject({
      name: "TemplateExpressionError",
      viewName: "page",
      expression: "user.name",
      availableVariables: ["title"],
    });
  }
});
