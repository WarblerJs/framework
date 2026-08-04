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
