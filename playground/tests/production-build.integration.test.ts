import { expect, test } from "bun:test";
import { buildCommand, validateProject } from "@warblerjs/cli";
import { playgroundRoot } from "./helpers";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

test("production build contains executable application, generated provider bindings, and no compiler or watcher", async () => {
  const isolatedRoot = await copyPlaygroundFixture();
  try {
    const result = await buildCommand(await validateProject(isolatedRoot), {
      minify: false,
      sourcemap: true,
    });
    expect(await Bun.file(result.entry).exists()).toBe(true);
    const source = await Bun.file(result.entry).text();
    expect(source).not.toContain("@warblerjs/compiler");
    expect(source).not.toContain("@warblerjs/cli");
    expect(source).not.toContain("SourceWatcher");
    const manifest = await Bun.file(`${isolatedRoot}/dist/.warbler/build-manifest.json`).json();
    expect(manifest.enabledTransports).toEqual(["http", "websocket"]);
    const providersSource = await Bun.file(`${isolatedRoot}/.warbler/generated/providers.generated.ts`).text();
    // Compiler-generated provider rows: dense numeric id/dependencyIds/scope, not a Map<token, record> literal.
    expect(providersSource).toMatch(/id:\s*\d+,/u);
    expect(providersSource).toMatch(/dependencyIds:\s*Object\.freeze\(\[/u);
    expect(providersSource).toMatch(/scope:\s*"(graph|root|request)"/u);
    expect(providersSource).not.toContain("new Map<ProviderToken");
    expect(source).toMatch(/dependencyIds:\s*Object\.freeze\(\[/u);
    expect(source).toMatch(/scope:\s*"(graph|root|request)"/u);
  } finally {
    await rm(isolatedRoot, { force: true, recursive: true });
  }
}, 20_000);

async function copyPlaygroundFixture(): Promise<string> {
  const root = await mkdtemp(join(playgroundRoot, "..", ".playground-production-"));
  await cp(playgroundRoot, root, {
    recursive: true,
    filter(source) {
      return !source.includes("/node_modules")
        && !source.includes("/.warbler")
        && !source.includes("/dist")
        && !source.includes("/tests");
    },
  });
  await symlink(join(playgroundRoot, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}
