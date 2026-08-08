import { describe, expect, test } from "bun:test";
import {
  createCompiledViewArtifact,
  renderCompiledView,
} from "../src";

describe("view builtins channel", () => {
  test("resolves function builtins via ordinary call expressions", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        home: "<a href=\"{{ route('users.show', user.id) }}\">{{ tr('auth.login') }}</a>",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
      data: { user: { id: 42 } },
      builtins: {
        route: (name: string, id: number) => `/${name.replace(".", "/")}/${id}`,
        tr: (key: string) => `translated:${key}`,
      },
    });

    expect(html).toBe('<a href="/users/show/42">translated:auth.login</a>');
  });

  test("resolves value builtins as bare identifiers, respecting raw vs escaped interpolation", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        home: "{{{ csrfField }}} token={{ csrfToken }}",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
      builtins: {
        csrfField: '<input type="hidden" name="_csrf" value="abc&123">',
        csrfToken: 'abc&123',
      },
    });

    expect(html).toBe('<input type="hidden" name="_csrf" value="abc&123"> token=abc&amp;123');
  });

  test("builtins are available inside partials via @import", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        home: "@import('partial')",
        partial: "{{ asset('app.css') }}",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
      builtins: { asset: (path: string) => `/static/${path}` },
    });

    expect(html).toBe("/static/app.css");
  });

  test("builtins are available inside @for loop bodies alongside loop variables", async () => {
    const artifact = createCompiledViewArtifact({
      templates: {
        home: "@for (item of items) { {{ tr(item) }} }",
      },
    });

    const html = await renderCompiledView({
      artifact,
      name: "home",
      data: { items: ["a", "b"] },
      builtins: { tr: (key: string) => key.toUpperCase() },
    });

    expect(html.replace(/\s+/gu, " ").trim()).toBe("A B");
  });

  test("omitting builtins behaves exactly as before (backward compatible)", async () => {
    const artifact = createCompiledViewArtifact({
      templates: { home: "{{ name }}" },
    });

    const html = await renderCompiledView({ artifact, name: "home", data: { name: "Noah" } });

    expect(html).toBe("Noah");
  });
});
