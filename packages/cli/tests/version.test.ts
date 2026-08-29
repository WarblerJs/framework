import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLI_VERSION, UNKNOWN_VERSION, resolveProjectFrameworkVersion } from "../src/version";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("Warbler package version resolution", () => {
  test("CLI and project framework versions are independent", async () => {
    const root = await packageFixture("8.7.6", "src/index.ts");
    cleanup.push(() => rm(root, { recursive: true, force: true }));

    expect(await resolveProjectFrameworkVersion(root)).toBe("8.7.6");
    expect(await resolveProjectFrameworkVersion(root)).not.toBe(CLI_VERSION);
  });

  test("framework resolution failure uses an honest fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "warbler-version-missing-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));

    expect(await resolveProjectFrameworkVersion(root)).toBe(UNKNOWN_VERSION);
    expect(await resolveProjectFrameworkVersion(root)).not.toBe(CLI_VERSION);
  });

  test("packed framework layouts do not require package source directories", async () => {
    const root = await packageFixture("4.5.6", "dist/index.js");
    cleanup.push(() => rm(root, { recursive: true, force: true }));

    expect(await resolveProjectFrameworkVersion(root)).toBe("4.5.6");
  });
});

async function packageFixture(version: string, entry: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-version-fixture-"));
  const packageRoot = join(root, "node_modules/@warblerjs/framework");
  const entryPath = join(packageRoot, entry);
  await mkdir(entryPath.slice(0, entryPath.lastIndexOf("/")), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "version-fixture", private: true }, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@warblerjs/framework",
    version,
    type: "module",
    exports: { ".": `./${entry}` },
  }, null, 2)}\n`, "utf8");
  await writeFile(entryPath, "export {};\n", "utf8");
  return root;
}
