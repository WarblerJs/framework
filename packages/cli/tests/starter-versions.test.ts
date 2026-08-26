import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertLocalStarterPackages,
  generateStarterPackageVersions,
  readStarterVersions,
  renderGeneratedFile,
  STARTER_PACKAGE_DESCRIPTORS,
  StarterVersionGenerationError,
} from "../scripts/generate-starter-package-versions";
import { CLI_VERSION } from "../src/version";
import { createStarterFiles, starterDependencyRange } from "../src/new/starter-files";
import { STARTER_PACKAGE_VERSIONS } from "../src/new/starter-package-versions.generated";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("starter package version manifest", () => {
  test("generated values match the reviewed compatibility catalog", async () => {
    const root = repoRoot();
    const catalog = await Bun.file(join(root, "packages/cli/starter-compatibility.json")).json();
    expect(await readStarterVersions(root)).toEqual(STARTER_PACKAGE_VERSIONS);
    expect(STARTER_PACKAGE_VERSIONS).toEqual(catalog);
    expect(Object.keys(STARTER_PACKAGE_VERSIONS)).toEqual(STARTER_PACKAGE_DESCRIPTORS.map((item) => item.key));
  });

  test("every catalog package exists locally and has the expected package name", async () => {
    await expect(assertLocalStarterPackages(repoRoot())).resolves.toBeUndefined();
  });

  test("local package versions are not the starter dependency authority", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeManifest(root, "framework", "@warblerjs/framework", "9.9.9");
    await generateStarterPackageVersions({ root });
    const generated = await readFile(generatedPath(root), "utf8");
    expect(generated).toContain('framework: "0.1.3"');
    expect(generated).not.toContain("9.9.9");
  });

  test("check mode succeeds when current", async () => {
    const result = await generateStarterPackageVersions({ root: repoRoot(), check: true });
    expect(result.changed).toBe(false);
    expect(result.versions).toEqual(STARTER_PACKAGE_VERSIONS);
    expect((await runGenerator(repoRoot(), "--check")).exitCode).toBe(0);
  });

  test("check mode fails without writing when stale", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await generateStarterPackageVersions({ root });
    const generated = generatedPath(root);
    const stale = "/** stale file */\n";
    await writeFile(generated, stale, "utf8");
    const script = await runGenerator(root, "--check");
    expect(script.exitCode).toBe(1);
    expect(script.stderr).toContain("Starter package version manifest is stale");
    await expect(generateStarterPackageVersions({ root, check: true })).rejects.toThrow(StarterVersionGenerationError);
    expect(await readFile(generated, "utf8")).toBe(stale);
  });

  test("regeneration is deterministic and idempotent", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const first = await generateStarterPackageVersions({ root });
    const firstContent = await readFile(generatedPath(root), "utf8");
    const second = await generateStarterPackageVersions({ root });
    const secondContent = await readFile(generatedPath(root), "utf8");
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(secondContent).toBe(firstContent);
    expect(firstContent).toBe(renderGeneratedFile(first.versions));
  });

  test("malformed JSON fails clearly", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, "packages/cli/starter-compatibility.json"), "{ nope", "utf8");
    await expect(readStarterVersions(root)).rejects.toThrow("malformed JSON");
  });

  test("missing package manifest fails clearly", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, "packages/config/package.json"), { force: true });
    await expect(readStarterVersions(root)).rejects.toThrow("Unable to read package manifest");
  });

  test("mismatched package name fails clearly", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeManifest(root, "config", "@warblerjs/not-config", "0.1.0");
    await expect(readStarterVersions(root)).rejects.toThrow("Package manifest name mismatch");
  });

  test("missing or invalid version fails clearly", async () => {
    const missing = await fixtureRoot(); cleanup.push(() => rm(missing, { recursive: true, force: true }));
    await writeCatalog(missing, { config: undefined });
    await expect(readStarterVersions(missing)).rejects.toThrow("version is missing");

    const invalid = await fixtureRoot(); cleanup.push(() => rm(invalid, { recursive: true, force: true }));
    await writeCatalog(invalid, { config: "latest" });
    await expect(readStarterVersions(invalid)).rejects.toThrow("Unsupported SemVer version");
  });

  test("starter package.json uses every compatibility version and CLI_VERSION", () => {
    const packageFile = createStarterFiles({
      name: "version-sync-test",
      secrets: {
        cryptoKey: "crypto-key-for-version-test",
        hmacKey: "hmac-key-for-version-test",
      },
    }).find((item) => item.path === "package.json");
    expect(packageFile).toBeDefined();
    const manifest = JSON.parse(packageFile!.content) as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };
    for (const descriptor of STARTER_PACKAGE_DESCRIPTORS) {
      expect(manifest.dependencies[descriptor.packageName]).toBe(starterDependencyRange(STARTER_PACKAGE_VERSIONS[descriptor.key]!));
    }
    expect(manifest.devDependencies["@warblerjs/cli"]).toBe(starterDependencyRange(CLI_VERSION));
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
  });

  test("prerelease range behavior is explicit", () => {
    expect(starterDependencyRange("0.1.0")).toBe("^0.1.0");
    expect(starterDependencyRange("0.1.0-rc.0")).toBe("0.1.0-rc.0");
    expect(starterDependencyRange("1.2.3-beta.4")).toBe("1.2.3-beta.4");
  });
});

function repoRoot(): string {
  return resolve(import.meta.dir, "..", "..", "..");
}

async function runGenerator(root: string, ...args: readonly string[]): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const child = Bun.spawn([
    "bun",
    "run",
    resolve(import.meta.dir, "../scripts/generate-starter-package-versions.ts"),
    "--root",
    root,
    ...args,
  ], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

function generatedPath(root: string): string {
  return join(root, "packages/cli/src/new/starter-package-versions.generated.ts");
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-starter-versions-"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "warbler", private: true }, null, 2)}\n`, "utf8");
  await mkdir(join(root, "packages/cli/src/new"), { recursive: true });
  await writeCatalog(root);
  for (const descriptor of STARTER_PACKAGE_DESCRIPTORS) {
    await writeManifest(root, descriptor.directory, descriptor.packageName, "0.0.0");
  }
  return root;
}

async function writeCatalog(root: string, overrides: Readonly<Record<string, string | undefined>> = {}): Promise<void> {
  const catalog: Record<string, string> = {
    config: "0.1.0",
    crypto: "0.1.3",
    database: "0.1.0",
    email: "0.1.3",
    framework: "0.1.3",
    frontend: "0.1.0",
    http: "0.1.3",
    i18n: "0.1.2",
      runtime: "0.1.3",
      view: "0.1.0-rc.0",
      websocket: "0.1.0",
    };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete catalog[key];
    else catalog[key] = value;
  }
  await writeFile(join(root, "packages/cli/starter-compatibility.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function writeManifest(root: string, directory: string, name: string, version: string): Promise<void> {
  const target = join(root, "packages", directory, "package.json");
  await mkdir(join(root, "packages", directory), { recursive: true });
  await writeFile(target, `${JSON.stringify({ name, version, type: "module", private: false }, null, 2)}\n`, "utf8");
}
