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
  expect(manifest.enabledTransports).toEqual(["http", "websocket"]);
});

test("production build's generated provider bindings stay compiler-owned", async () => {
  const providersSource = await Bun.file(`${playgroundRoot}/.warbler/generated/providers.generated.ts`).text();
  expect(providersSource).toContain("providerBindings = Object.freeze([");
  expect(providersSource).not.toContain("new Map<ProviderToken");
  const result = await buildCommand(await validateProject(playgroundRoot), { minify: false, sourcemap: false });
  const bundled = await Bun.file(result.entry).text();
  expect(bundled).not.toContain("new Map<ProviderToken");
});
