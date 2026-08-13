import { expect, test } from "bun:test";
import { buildCommand, validateProject } from "@warbler/cli";
import { playgroundRoot } from "./helpers";

test("production build contains executable application but no compiler or watcher", async () => {
  const result = await buildCommand(await validateProject(playgroundRoot), {
    minify: true,
    sourcemap: true,
  });
  expect(await Bun.file(result.entry).exists()).toBe(true);
  const source = await Bun.file(result.entry).text();
  expect(source).not.toContain("@warbler/compiler");
  expect(source).not.toContain("@warbler/cli");
  expect(source).not.toContain("SourceWatcher");
  const manifest = await Bun.file(`${playgroundRoot}/dist/.warbler/build-manifest.json`).json();
  expect(manifest.enabledTransports).toEqual(["http"]);
});

test("production build's generated provider bindings are numeric-ID-shaped, not a hand-rolled token map", async () => {
  const providersSource = await Bun.file(`${playgroundRoot}/.warbler/generated/providers.generated.ts`).text();
  // Compiler-generated provider rows: dense numeric id/dependencyIds/scope, not a Map<token, record> literal.
  expect(providersSource).toMatch(/id:\s*\d+,/u);
  expect(providersSource).toMatch(/dependencyIds:\s*Object\.freeze\(\[/u);
  expect(providersSource).toMatch(/scope:\s*"(graph|root|request)"/u);
  expect(providersSource).not.toContain("new Map<ProviderToken");
  // @warbler/runtime/@warbler/core stay external (framework internals, including the token->id
  // index, are never inlined) — only the compiler's own generated bindings are bundled inline.
  const result = await buildCommand(await validateProject(playgroundRoot), { minify: false, sourcemap: false });
  const bundled = await Bun.file(result.entry).text();
  expect(bundled).toMatch(/dependencyIds:\s*Object\.freeze\(\[/u);
  expect(bundled).toMatch(/scope:\s*"(graph|root|request)"/u);
});
