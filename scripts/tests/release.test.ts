import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertPublishableManifest,
  createReleasePlan,
  discoverPublishablePackages,
  npmTag,
  releaseManifest,
  ReleaseError,
  resolveWorkspaceRange,
  runRelease,
  scanStaleWarblerReferences,
  type NpmClient,
  type PublishedPackageMetadata,
} from "../release/index";
import { RegistryNpmClient } from "../release/npm-client";
import { packReleasePackage } from "../release/package";
import { targetVersionMap } from "../release/planner";
import type { PackageManifest, ReleasePlannerOptions } from "../release/types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

describe("release workspace ranges", () => {
  test("workspace * resolves to exact target version", () => {
    expect(resolveWorkspaceRange("workspace:*", "0.1.1")).toBe("0.1.1");
  });

  test("workspace ^ resolves correctly", () => {
    expect(resolveWorkspaceRange("workspace:^", "0.1.1")).toBe("^0.1.1");
  });

  test("workspace ~ resolves correctly", () => {
    expect(resolveWorkspaceRange("workspace:~", "0.1.1")).toBe("~0.1.1");
  });
});

describe("release planning", () => {
  test("orders packages topologically", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/core": "workspace:*" } }),
      http: manifest("@warblerjs/http", { dependencies: { "@warblerjs/validators": "workspace:*" } }),
    });
    const plan = await planFor(root, published("@warblerjs/core", "0.1.0"), published("@warblerjs/validators", "0.1.0"), published("@warblerjs/http", "0.1.0"));
    expect(plan.packages.map((item) => item.name)).toEqual([
      "@warblerjs/core",
      "@warblerjs/validators",
      "@warblerjs/http",
    ]);
  });

  test("detects dependency cycles", async () => {
    const root = await fixture({
      a: manifest("@warblerjs/a", { dependencies: { "@warblerjs/b": "workspace:*" } }),
      b: manifest("@warblerjs/b", { dependencies: { "@warblerjs/a": "workspace:*" } }),
    });
    await expect(planFor(root)).rejects.toThrow(ReleaseError);
  });

  test("skips already published packages with valid metadata", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    const plan = await planFor(root, published("@warblerjs/core", "0.1.0"));
    expect(plan.packages[0]?.shouldPublish).toBe(false);
    expect(plan.packages[0]?.reason).toBe("already-published");
  });

  test("selects an unpublished patch for broken published workspace metadata", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    });
    const plan = await planFor(
      root,
      published("@warblerjs/core", "0.1.0"),
      published("@warblerjs/validators", "0.1.0", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    );
    expect(plan.packages.find((item) => item.name === "@warblerjs/validators")?.targetVersion).toBe("0.1.1");
  });

  test("derives prerelease npm tags", () => {
    expect(npmTag("1.0.0-rc.1")).toBe("rc");
    expect(npmTag("1.0.0-beta.2")).toBe("beta");
    expect(npmTag("1.0.0")).toBe("latest");
  });

  test("detects malformed publishable package scopes", async () => {
    const root = await fixture({ core: manifest("@warbler/core") });
    await expect(discoverPublishablePackages(root)).rejects.toThrow(ReleaseError);
  });

  test("detects stale @warbler/* references", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    await writeFile(join(root, "README.md"), "import from @warbler/core\n");
    const stale = await scanStaleWarblerReferences(root);
    expect(stale[0]?.value).toBe("@warbler/");
  });

  test("detects malformed doubled Warbler scopes", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "@warblerjsjs/app", private: true }, null, 2)}\n`);
    const stale = await scanStaleWarblerReferences(root);
    expect(stale[0]?.value).toBe("@warblerjsjs/");
  });

  test("release manifest resolves dependency target versions", () => {
    const resolved = releaseManifest(
      manifest("@warblerjs/http", { dependencies: { "@warblerjs/framework": "workspace:^" } }),
      "0.1.1",
      new Map([["@warblerjs/framework", "0.1.2"]]),
    );
    expect(resolved.dependencies?.["@warblerjs/framework"]).toBe("^0.1.2");
  });

  test("explicit patch bump publishes the next stable patch", async () => {
    const root = await fixture({ i18n: manifest("@warblerjs/i18n", { version: "0.1.1" }) });
    const plan = await planFor(root, {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    }, published("@warblerjs/i18n", "0.1.1"));
    expect(plan.packages[0]?.currentVersion).toBe("0.1.1");
    expect(plan.packages[0]?.targetVersion).toBe("0.1.2");
    expect(plan.packages[0]?.reason).toBe("explicit-patch");
    expect(plan.packages[0]?.shouldPublish).toBe(true);
  });

  test("direct dependents receive patch releases when dependency metadata changes", async () => {
    const root = await fixture({
      i18n: manifest("@warblerjs/i18n"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/i18n": "workspace:*" } }),
      core: manifest("@warblerjs/core"),
    });
    const plan = await planFor(root, {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    },
    published("@warblerjs/i18n", "0.1.0"),
    published("@warblerjs/validators", "0.1.0", { dependencies: { "@warblerjs/i18n": "0.1.0" } }),
    published("@warblerjs/core", "0.1.0"));
    const validators = plan.packages.find((item) => item.name === "@warblerjs/validators");
    const core = plan.packages.find((item) => item.name === "@warblerjs/core");
    expect(validators?.targetVersion).toBe("0.1.1");
    expect(validators?.reason).toBe("dependency-propagation");
    expect(core?.shouldPublish).toBe(false);
  });

  test("dependency propagation recurses transitively", async () => {
    const root = await fixture({
      i18n: manifest("@warblerjs/i18n"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/i18n": "workspace:*" } }),
      compiler: manifest("@warblerjs/compiler", { dependencies: { "@warblerjs/validators": "workspace:*" } }),
      cli: manifest("@warblerjs/cli", { dependencies: { "@warblerjs/compiler": "workspace:*" } }),
    });
    const plan = await planFor(root, {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    },
    published("@warblerjs/i18n", "0.1.0"),
    published("@warblerjs/validators", "0.1.0", { dependencies: { "@warblerjs/i18n": "0.1.0" } }),
    published("@warblerjs/compiler", "0.1.0", { dependencies: { "@warblerjs/validators": "0.1.0" } }),
    published("@warblerjs/cli", "0.1.0", { dependencies: { "@warblerjs/compiler": "0.1.0" } }));
    expect(plan.packages.map((item) => [item.name, item.targetVersion, item.reason])).toEqual([
      ["@warblerjs/i18n", "0.1.1", "explicit-patch"],
      ["@warblerjs/validators", "0.1.1", "dependency-propagation"],
      ["@warblerjs/compiler", "0.1.1", "dependency-propagation"],
      ["@warblerjs/cli", "0.1.1", "dependency-propagation"],
    ]);
  });

  test("unrelated published packages remain skipped during explicit patch release", async () => {
    const root = await fixture({
      i18n: manifest("@warblerjs/i18n"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/i18n": "workspace:*" } }),
      config: manifest("@warblerjs/config"),
    });
    const plan = await planFor(root, {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    },
    published("@warblerjs/i18n", "0.1.0"),
    published("@warblerjs/validators", "0.1.0", { dependencies: { "@warblerjs/i18n": "0.1.0" } }),
    published("@warblerjs/config", "0.1.0"));
    const config = plan.packages.find((item) => item.name === "@warblerjs/config");
    expect(config?.targetVersion).toBe("0.1.0");
    expect(config?.shouldPublish).toBe(false);
    expect(config?.reason).toBe("already-published");
  });

  test("explicit patch fails safely when target version already exists", async () => {
    const root = await fixture({ i18n: manifest("@warblerjs/i18n", { version: "0.1.1" }) });
    await expect(planFor(root, {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    }, published("@warblerjs/i18n", "0.1.1"), published("@warblerjs/i18n", "0.1.2"))).rejects.toThrow(ReleaseError);
  });

  test("explicit patch rejects prerelease source versions", async () => {
    const root = await fixture({ i18n: manifest("@warblerjs/i18n", { version: "0.1.0-rc.0" }) });
    await expect(planFor(root, {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    }, published("@warblerjs/i18n", "0.1.0-rc.0"))).rejects.toThrow("--patch does not support prerelease versions");
  });

  test("supports multiple explicit patch requests", async () => {
    const root = await fixture({
      i18n: manifest("@warblerjs/i18n"),
      core: manifest("@warblerjs/core"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/i18n": "workspace:*", "@warblerjs/core": "workspace:*" } }),
    });
    const plan = await planFor(root, {
      explicitReleases: [
        { packageName: "@warblerjs/i18n", bump: "patch" },
        { packageName: "@warblerjs/core", bump: "patch" },
      ],
    },
    published("@warblerjs/i18n", "0.1.0"),
    published("@warblerjs/core", "0.1.0"),
    published("@warblerjs/validators", "0.1.0", { dependencies: { "@warblerjs/i18n": "0.1.0", "@warblerjs/core": "0.1.0" } }));
    expect(plan.packages.filter((item) => item.reason === "explicit-patch").map((item) => item.name).sort()).toEqual([
      "@warblerjs/core",
      "@warblerjs/i18n",
    ]);
    expect(plan.packages.find((item) => item.name === "@warblerjs/validators")?.reason).toBe("dependency-propagation");
  });

  test("final staged manifest uses propagated concrete dependency versions", async () => {
    const root = await fixture({
      i18n: manifest("@warblerjs/i18n"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/i18n": "workspace:*" } }),
    });
    const workspacePackages = await discoverPublishablePackages(root);
    const plan = await createReleasePlan(root, workspacePackages, new FakeNpm({ published: [
      published("@warblerjs/i18n", "0.1.0"),
      published("@warblerjs/validators", "0.1.0", { dependencies: { "@warblerjs/i18n": "0.1.0" } }),
    ] }), {
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    });
    const validatorsWorkspace = workspacePackages.find((item) => item.name === "@warblerjs/validators")!;
    const validatorsRelease = plan.packages.find((item) => item.name === "@warblerjs/validators")!;
    const packed = await packReleasePackage(validatorsWorkspace, validatorsRelease, targetVersionMap(plan));
    expect(packed.manifest.dependencies?.["@warblerjs/i18n"]).toBe("0.1.1");
    expect(JSON.stringify(packed.manifest)).not.toContain("workspace:");
  });

  test("release order is deterministic across branched dependency graphs", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      validators: manifest("@warblerjs/validators", { dependencies: { "@warblerjs/core": "workspace:*" } }),
      runtime: manifest("@warblerjs/runtime", { dependencies: { "@warblerjs/core": "workspace:*" } }),
      cli: manifest("@warblerjs/cli", { dependencies: { "@warblerjs/runtime": "workspace:*", "@warblerjs/validators": "workspace:*" } }),
    });
    const expected = ["@warblerjs/core", "@warblerjs/runtime", "@warblerjs/validators", "@warblerjs/cli"];
    for (let index = 0; index < 3; index++) {
      const plan = await planFor(root);
      expect(plan.packages.map((item) => item.name)).toEqual(expected);
    }
  });
});

describe("release validation and execution", () => {
  test("registry client queries scoped package versions with npm-compatible URLs", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    const mockFetch = Object.assign((input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ version: "1.2.3", versions: { "1.2.3": {} } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
    }, { preconnect: originalFetch.preconnect });
    globalThis.fetch = mockFetch;
    try {
      const client = new RegistryNpmClient("https://registry.example.test/");
      await client.metadata("@scope/pkg", "1.2.3");
      await client.versions("@scope/pkg");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toEqual([
      "https://registry.example.test/@scope%2Fpkg/1.2.3",
      "https://registry.example.test/@scope%2Fpkg",
    ]);
  });

  test("tarball manifest validation rejects workspace protocols", () => {
    expect(() => assertPublishableManifest(
      manifest("@warblerjs/http", { dependencies: { "@warblerjs/core": "workspace:*" } }),
      "@warblerjs/http",
      "0.1.0",
    )).toThrow(ReleaseError);
  });

  test("failed publish aborts remaining packages", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      http: manifest("@warblerjs/http", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    });
    const npm = new FakeNpm({ failPublish: "@warblerjs/core" });
    await expect(runRelease({ root, npm, allowDirty: true, noTests: true })).rejects.toThrow(ReleaseError);
    expect(npm.published).toEqual(["@warblerjs/core:latest"]);
  });

  test("original package manifests are restored after failure because release uses staging", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    const path = join(root, "packages/core/package.json");
    const before = await readFile(path, "utf8");
    await expect(runRelease({ root, npm: new FakeNpm({ failPublish: "@warblerjs/core" }), allowDirty: true, noTests: true })).rejects.toThrow(ReleaseError);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  test("dry-run never calls real publish", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    const npm = new FakeNpm();
    const result = await runRelease({ root, npm, dryRun: true, noTests: true });
    expect(result.published).toEqual(["@warblerjs/core@0.1.0"]);
    expect(npm.published).toEqual([]);
  });

  test("explicit patch dry-run never publishes while reporting planned releases", async () => {
    const root = await fixture({ i18n: manifest("@warblerjs/i18n", { version: "0.1.1" }) });
    const npm = new FakeNpm({ published: [published("@warblerjs/i18n", "0.1.1")] });
    const result = await runRelease({
      root,
      npm,
      dryRun: true,
      noTests: true,
      explicitReleases: [{ packageName: "@warblerjs/i18n", bump: "patch" }],
    });
    expect(result.published).toEqual(["@warblerjs/i18n@0.1.2"]);
    expect(npm.published).toEqual([]);
  });
});

async function fixture(packages: Readonly<Record<string, PackageManifest>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-release-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "packages"), { recursive: true });
  await writeFile(join(root, "README.md"), "Warbler\n");
  for (const [directory, packageManifest] of Object.entries(packages)) {
    const packageRoot = join(root, "packages", directory);
    await mkdir(join(packageRoot, "src"), { recursive: true });
    await writeFile(join(packageRoot, "src/index.ts"), "export {};\n");
    await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`);
  }
  return root;
}

function manifest(name: string, overrides: Partial<PackageManifest> = {}): PackageManifest {
  return Object.freeze({
    name,
    version: "0.1.0",
    type: "module",
    private: false,
    files: Object.freeze(["src"]),
    exports: Object.freeze({ ".": "./src/index.ts" }),
    ...overrides,
  });
}

function published(name: string, version: string, metadata: Partial<PublishedPackageMetadata> = {}): PublishedPackageMetadata & { readonly name: string } {
  return Object.freeze({
    name,
    exists: true,
    version,
    ...metadata,
  });
}

async function planFor(
  root: string,
  optionsOrFirstPublished?: ReleasePlannerOptions | (PublishedPackageMetadata & { readonly name: string }),
  ...publishedMetadata: readonly (PublishedPackageMetadata & { readonly name: string })[]
) {
  const options = isPlannerOptions(optionsOrFirstPublished) ? optionsOrFirstPublished : {};
  const publishedItems = optionsOrFirstPublished === undefined || isPlannerOptions(optionsOrFirstPublished)
    ? publishedMetadata
    : [optionsOrFirstPublished, ...publishedMetadata];
  const packages = await discoverPublishablePackages(root);
  return createReleasePlan(root, packages, new FakeNpm({ published: publishedItems }), options);
}

function isPlannerOptions(value: ReleasePlannerOptions | (PublishedPackageMetadata & { readonly name: string }) | undefined): value is ReleasePlannerOptions {
  return value !== undefined && !("exists" in value);
}

class FakeNpm implements NpmClient {
  public readonly registry = "https://registry.example.test/";
  public readonly published: string[] = [];
  readonly #metadata = new Map<string, PublishedPackageMetadata>();
  readonly #failPublish: string | undefined;

  public constructor(options: Readonly<{ readonly published?: readonly (PublishedPackageMetadata & { readonly name: string })[]; readonly failPublish?: string }> = {}) {
    this.#failPublish = options.failPublish;
    for (const item of options.published ?? []) this.#metadata.set(`${item.name}@${item.version ?? "0.1.0"}`, item);
  }

  public metadata(name: string, version: string): Promise<PublishedPackageMetadata> {
    return Promise.resolve(this.#metadata.get(`${name}@${version}`) ?? Object.freeze({ exists: false }));
  }

  public versions(name: string): Promise<readonly string[]> {
    const prefix = `${name}@`;
    return Promise.resolve(Object.freeze([...this.#metadata.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort()));
  }

  public whoami(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public publish(tarball: string, tag: string): Promise<void> {
    const name = tarball.includes("warblerjs-core") ? "@warblerjs/core" : tarball.includes("warblerjs-http") ? "@warblerjs/http" : "@warblerjs/unknown";
    this.published.push(`${name}:${tag}`);
    if (name === this.#failPublish) return Promise.reject(new ReleaseError(`publish failed for ${name}`));
    return Promise.resolve();
  }
}
