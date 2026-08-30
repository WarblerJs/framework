import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertPublishableManifest,
  compareSemver,
  createReleasePlan,
  discoverPublishablePackages,
  discoverWorkspacePackages,
  manifestHasLocalDependencyReference,
  manifestHasWorkspaceProtocol,
  releaseManifest,
  releaseTag,
  resolveWorkspaceRange,
  runRelease,
  type NpmClient,
  type PublishedPackageMetadata,
} from "../release/index";
import { generateStarterConfigs } from "../../packages/cli/scripts/generate-starter-configs";
import { generateStarterPackageVersions } from "../../packages/cli/scripts/generate-starter-package-versions";
import { packReleasePackage } from "../release/package";
import { targetVersionMap } from "../release/planner";
import { syncLockstepVersions } from "../release/sync";
import { ReleaseError, type PackageManifest, type ReleasePlannerOptions } from "../release/types";
import type { ReleaseCommandRunner } from "../release/types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("lockstep release metadata", () => {
  test("workspace ranges still resolve for compatibility helpers", () => {
    expect(resolveWorkspaceRange("workspace:*", "0.5.0")).toBe("0.5.0");
    expect(resolveWorkspaceRange("workspace:^", "0.5.0")).toBe("^0.5.0");
    expect(resolveWorkspaceRange("workspace:~", "0.5.0")).toBe("~0.5.0");
  });

  test("strict SemVer, prerelease tags, and ordering are validated", () => {
    expect(releaseTag("0.6.0-rc.1")).toBe("v0.6.0-rc.1");
    expect(compareSemver("0.6.0-rc.1", "0.6.0")).toBeLessThan(0);
    expect(() => releaseTag("0.6")).toThrow(ReleaseError);
  });

  test("discovers public packages from root workspaces and excludes private workspaces", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      playground: manifest("@warblerjs/playground", { private: true }),
    });
    const workspaces = await discoverWorkspacePackages(root);
    const publishable = await discoverPublishablePackages(root);
    expect(workspaces.map((item) => item.name)).toContain("@warblerjs/playground");
    expect(publishable.map((item) => item.name)).toEqual(["@warblerjs/core"]);
  });

  test("new public packages are automatically included and ordered by dependencies", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      extra: manifest("@warblerjs/extra", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    });
    const plan = await planFor(root);
    expect(plan.packages.map((item) => item.name)).toEqual(["@warblerjs/core", "@warblerjs/extra"]);
  });

  test("devDependencies do not affect release order", async () => {
    const root = await fixture({
      "a-tool": manifest("@warblerjs/a-tool", { devDependencies: { "@warblerjs/z-core": "workspace:*" } }),
      "z-core": manifest("@warblerjs/z-core"),
    });
    const plan = await planFor(root);
    expect(plan.packages.map((item) => item.name)).toEqual(["@warblerjs/a-tool", "@warblerjs/z-core"]);
  });

  test("cycles and missing publish metadata fail clearly", async () => {
    const cycle = await fixture({
      a: manifest("@warblerjs/a", { dependencies: { "@warblerjs/b": "workspace:*" } }),
      b: manifest("@warblerjs/b", { dependencies: { "@warblerjs/a": "workspace:*" } }),
    });
    await expect(planFor(cycle)).rejects.toThrow(ReleaseError);

    const missingPublishConfig = await fixture({
      core: manifest("@warblerjs/core", { publishConfig: undefined }),
    }, "0.5.0", false);
    await expect(discoverPublishablePackages(missingPublishConfig)).rejects.toThrow("publishConfig.access public");
  });

  test("packed manifests use exact runtime dependencies, compatible peers, no devDependencies, and deterministic ordering", () => {
    const resolved = releaseManifest(
      manifest("@warblerjs/http", {
        dependencies: { zod: "^4.0.0", "@warblerjs/core": "workspace:*" },
        optionalDependencies: { "@warblerjs/view": "workspace:^", "@types/bun": "^1.3.14" },
        peerDependencies: { typescript: "^5.9.2", "@warblerjs/transport": "workspace:~" },
        devDependencies: { "@warblerjs/config": "workspace:*" },
      }),
      "0.5.0",
      new Map([
        ["@warblerjs/core", "0.5.0"],
        ["@warblerjs/view", "0.5.0"],
        ["@warblerjs/transport", "0.5.0"],
        ["@warblerjs/config", "0.5.0"],
      ]),
    );
    expect(resolved.dependencies?.["@warblerjs/core"]).toBe("0.5.0");
    expect(resolved.dependencies?.zod).toBe("^4.0.0");
    expect(resolved.optionalDependencies?.["@warblerjs/view"]).toBe("0.5.0");
    expect(resolved.optionalDependencies?.["@types/bun"]).toBe("^1.3.14");
    expect(resolved.peerDependencies?.["@warblerjs/transport"]).toBe("^0.5.0");
    expect(resolved.peerDependencies?.typescript).toBe("^5.9.2");
    expect(resolved.devDependencies).toBeUndefined();
    expect(Object.keys(resolved.dependencies ?? {})).toEqual(["@warblerjs/core", "zod"]);
    expect(Object.keys(resolved.optionalDependencies ?? {})).toEqual(["@types/bun", "@warblerjs/view"]);
    expect(Object.keys(resolved.peerDependencies ?? {})).toEqual(["@warblerjs/transport", "typescript"]);
  });

  test("private workspace runtime dependencies are rejected instead of rewritten to the canonical version", () => {
    expect(() => releaseManifest(
      manifest("@warblerjs/http", { dependencies: { "@warblerjs/private-runtime": "workspace:*" } }),
      "0.5.0",
      new Map([["@warblerjs/http", "0.5.0"]]),
    )).toThrow("@warblerjs/http: dependencies.@warblerjs/private-runtime uses a workspace protocol");
  });

  test("unknown workspace peer dependencies are rejected with owner, dependency, and field", () => {
    expect(() => releaseManifest(
      manifest("@warblerjs/http", { peerDependencies: { "@warblerjs/unknown-peer": "workspace:^" } }),
      "0.5.0",
      new Map([["@warblerjs/http", "0.5.0"]]),
    )).toThrow("@warblerjs/http: peerDependencies.@warblerjs/unknown-peer uses a workspace protocol");
  });

  test("normal external npm dependency ranges are preserved", () => {
    const resolved = releaseManifest(
      manifest("@warblerjs/http", {
        dependencies: { zod: "^4.0.0" },
        optionalDependencies: { "@types/bun": "^1.3.14" },
        peerDependencies: { typescript: "^5.9.2" },
      }),
      "0.5.0",
      new Map(),
    );
    expect(resolved.dependencies?.zod).toBe("^4.0.0");
    expect(resolved.optionalDependencies?.["@types/bun"]).toBe("^1.3.14");
    expect(resolved.peerDependencies?.typescript).toBe("^5.9.2");
  });

  test("valid first-party workspace dependencies rewrite by dependency field policy", () => {
    const resolved = releaseManifest(
      manifest("@warblerjs/http", {
        dependencies: { "@warblerjs/core": "workspace:*" },
        optionalDependencies: { "@warblerjs/view": "workspace:*" },
        peerDependencies: { "@warblerjs/transport": "workspace:*" },
        devDependencies: { "@warblerjs/config": "workspace:*" },
      }),
      "0.5.0",
      new Map([
        ["@warblerjs/core", "0.5.0"],
        ["@warblerjs/view", "0.5.0"],
        ["@warblerjs/transport", "0.5.0"],
      ]),
    );
    expect(resolved.dependencies?.["@warblerjs/core"]).toBe("0.5.0");
    expect(resolved.optionalDependencies?.["@warblerjs/view"]).toBe("0.5.0");
    expect(resolved.peerDependencies?.["@warblerjs/transport"]).toBe("^0.5.0");
    expect(resolved.devDependencies).toBeUndefined();
  });

  test("packed manifest validation rejects workspace and local references", () => {
    const workspace = manifest("@warblerjs/core", { dependencies: { "@warblerjs/config": "workspace:*" } });
    const local = manifest("@warblerjs/core", { dependencies: { "@warblerjs/config": "file:../config" } });
    expect(manifestHasWorkspaceProtocol(workspace)).toBe(true);
    expect(manifestHasLocalDependencyReference(local)).toBe(true);
    expect(() => assertPublishableManifest(workspace, "@warblerjs/core", "0.5.0")).toThrow(ReleaseError);
    expect(() => assertPublishableManifest(local, "@warblerjs/core", "0.5.0")).toThrow(ReleaseError);
  });

  test("package staging leaves source manifests untouched while packed manifests are publishable", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      http: manifest("@warblerjs/http", {
        dependencies: { "@warblerjs/core": "workspace:*" },
        peerDependencies: { "@warblerjs/core": "workspace:*" },
        devDependencies: { "@warblerjs/core": "workspace:*" },
      }),
    });
    const packages = await discoverPublishablePackages(root);
    const plan = await createReleasePlan(root, packages, new FakeNpm(), { targetVersion: "0.5.0" });
    const http = packages.find((item) => item.name === "@warblerjs/http")!;
    const release = plan.packages.find((item) => item.name === "@warblerjs/http")!;
    const before = await readFile(http.manifestPath, "utf8");
    const packed = await packReleasePackage(http, release, targetVersionMap(plan));
    expect(packed.manifest.dependencies?.["@warblerjs/core"]).toBe("0.5.0");
    expect(packed.manifest.peerDependencies?.["@warblerjs/core"]).toBe("^0.5.0");
    expect(packed.manifest.devDependencies).toBeUndefined();
    expect(await readFile(http.manifestPath, "utf8")).toBe(before);
    expect((await readJson(http.manifestPath)).devDependencies["@warblerjs/core"]).toBe("workspace:*");
  });
});

describe("lockstep synchronization", () => {
  test("synchronizes package versions, first-party dependencies, and starter metadata idempotently", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core", { version: "0.1.0" }),
      http: manifest("@warblerjs/http", { version: "0.1.0", dependencies: { "@warblerjs/core": "0.1.0" } }),
    }, "0.4.0");
    const first = await syncLockstepVersions({ root, version: "0.5.0" });
    const second = await syncLockstepVersions({ root, version: "0.5.0" });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect((await readJson(join(root, "package.json"))).version).toBe("0.5.0");
    expect((await readJson(join(root, "packages/http/package.json"))).dependencies["@warblerjs/core"]).toBe("workspace:*");
    expect((await readJson(join(root, "packages/cli/starter-compatibility.json"))).framework).toBe("0.5.0");
    await expect(syncLockstepVersions({ root, check: true })).resolves.toMatchObject({ changed: false });
  });

  test("check mode reports exact drift without rewriting", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core", { version: "0.1.0" }) }, "0.5.0", false);
    await expect(syncLockstepVersions({ root, check: true })).rejects.toThrow("version expected");
    expect((await readJson(join(root, "packages/core/package.json"))).version).toBe("0.1.0");
  });

  test("downgrades and duplicate targets are rejected", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") }, "0.5.0");
    await expect(syncLockstepVersions({ root, version: "0.4.9" })).rejects.toThrow("greater than");
    await expect(planFor(root, { targetVersion: "0.5.0" }, published("@warblerjs/core", "0.5.0"))).rejects.toThrow("already exists");
  });
});

describe("lockstep release execution", () => {
  test("dry-run performs no npm publish while reporting the full dependency order", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      http: manifest("@warblerjs/http", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    });
    const npm = new FakeNpm();
    const result = await runRelease({ root, npm, allowDirty: true, dryRun: true, noTests: true, targetVersion: "0.5.0" });
    expect(result.planned).toEqual(["@warblerjs/core@0.5.0", "@warblerjs/http@0.5.0"]);
    expect(result.published).toEqual([]);
    expect(npm.published).toEqual([]);
  });

  test("publishing is sequential and stops before dependents on failure", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      http: manifest("@warblerjs/http", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    });
    const npm = new FakeNpm({ failPublish: "@warblerjs/core" });
    const commands = createCommandRunner();
    await expect(runRelease({ root, npm, runCommand: commands.run, targetVersion: "0.5.0" })).rejects.toThrow(ReleaseError);
    expect(npm.published).toEqual(["@warblerjs/core:latest"]);
  });

  test("version drift fails before publication", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core", { version: "0.4.0" }) }, "0.5.0", false);
    const npm = new FakeNpm();
    await expect(runRelease({ root, npm, allowDirty: true, dryRun: true, noTests: true, targetVersion: "0.5.0" })).rejects.toThrow("version drift");
    expect(npm.published).toEqual([]);
  });

  test("failed root workspace tests abort before pack and publish", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    const npm = new FakeNpm();
    const commands = createCommandRunner({ failWorkspaceTests: true });
    const phases: string[] = [];
    await expect(runRelease({
      root,
      npm,
      allowDirty: true,
      dryRun: true,
      runCommand: commands.run,
      progress: (phase) => { phases.push(phase); },
      targetVersion: "0.5.0",
    })).rejects.toThrow("Workspace tests failed");
    expect(commands.calls.filter((call) => call === "bun test")).toHaveLength(1);
    expect(phases).toEqual(["Testing workspace"]);
    expect(npm.published).toEqual([]);
  });

  test("clean-worktree policy covers dry-run and real release combinations", async () => {
    const cases = [
      { dryRun: true, allowDirty: false, gitStatus: "", ok: true, git: true, published: false },
      { dryRun: true, allowDirty: false, gitStatus: " M package.json\n", ok: false, git: true, published: false },
      { dryRun: true, allowDirty: true, gitStatus: " M package.json\n", ok: true, git: false, published: false },
      { dryRun: false, allowDirty: false, gitStatus: "", ok: true, git: true, published: true },
      { dryRun: false, allowDirty: false, gitStatus: " M package.json\n", ok: false, git: true, published: false },
      { dryRun: false, allowDirty: true, gitStatus: "", ok: false, git: false, published: false },
    ] as const;
    for (const item of cases) {
      const root = await fixture({ core: manifest("@warblerjs/core") });
      const npm = new FakeNpm();
      const commands = createCommandRunner({ gitStatus: item.gitStatus });
      const release = runRelease({
        root,
        npm,
        dryRun: item.dryRun,
        allowDirty: item.allowDirty,
        runCommand: commands.run,
        targetVersion: "0.5.0",
      });
      if (item.ok) await expect(release).resolves.toBeDefined();
      else await expect(release).rejects.toThrow(ReleaseError);
      expect(commands.calls.includes("git status --short")).toBe(item.git);
      expect(npm.published.length > 0).toBe(item.published);
    }
  });

  test("real publish rejects --no-tests", async () => {
    const root = await fixture({ core: manifest("@warblerjs/core") });
    const npm = new FakeNpm();
    await expect(runRelease({ root, npm, noTests: true, targetVersion: "0.5.0" })).rejects.toThrow("--no-tests may only be used with --dry-run");
    expect(npm.published).toEqual([]);
  });

  test("dry-run executes pack, manifest validation, and import smoke without npm publish", async () => {
    const root = await fixture({
      core: manifest("@warblerjs/core"),
      http: manifest("@warblerjs/http", { dependencies: { "@warblerjs/core": "workspace:*" } }),
    });
    const npm = new FakeNpm();
    const phases: string[] = [];
    const result = await runRelease({
      root,
      npm,
      allowDirty: true,
      dryRun: true,
      noTests: true,
      progress: (phase) => { phases.push(phase); },
      targetVersion: "0.5.0",
    });
    expect(phases).toEqual(["Typechecking packages", "Packing packages", "Validating packed manifests", "Smoke-testing packed imports"]);
    expect(result.planned).toEqual(["@warblerjs/core@0.5.0", "@warblerjs/http@0.5.0"]);
    expect(result.published).toEqual([]);
    expect(npm.published).toEqual([]);
  });

  test("unplanned workspace dependency failure occurs before npm publish", async () => {
    const root = await fixture({
      private: manifest("@warblerjs/private-runtime", { private: true }),
      http: manifest("@warblerjs/http", { dependencies: { "@warblerjs/private-runtime": "workspace:*" } }),
    });
    const npm = new FakeNpm();
    const commands = createCommandRunner();
    await expect(runRelease({
      root,
      npm,
      runCommand: commands.run,
      targetVersion: "0.5.0",
    })).rejects.toThrow("dependencies.@warblerjs/private-runtime uses a workspace protocol");
    expect(npm.published).toEqual([]);
  });
});

async function fixture(packages: Readonly<Record<string, PackageManifest>>, rootVersion = "0.5.0", sync = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-release-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "packages"), { recursive: true });
  await writeJson(join(root, "package.json"), { name: "warbler", version: rootVersion, private: true, workspaces: ["packages/*"] });
  await mkdir(join(root, "packages/cli/src/new"), { recursive: true });
  await writeJson(join(root, "packages/cli/starter-compatibility.json"), starterCompatibility(rootVersion));
  await mkdir(join(root, "playground/src/config"), { recursive: true });
  await writeFile(join(root, "playground/.env.example"), "APP_ENV=development\n", "utf8");
  await writeFile(join(root, "playground/src/config/runtime.config.ts"), "export default {};\n", "utf8");
  for (const directory of Object.keys(starterCompatibility(rootVersion))) {
    if (packages[directory] !== undefined) continue;
    const packageRoot = join(root, "packages", directory);
    await mkdir(packageRoot, { recursive: true });
    await writeJson(join(packageRoot, "package.json"), {
      name: `@warblerjs/${directory}`,
      version: rootVersion,
      private: true,
    });
  }
  for (const [directory, packageManifest] of Object.entries(packages)) {
    const packageRoot = join(root, "packages", directory);
    await mkdir(join(packageRoot, "src"), { recursive: true });
    await writeFile(join(packageRoot, "src/index.ts"), "export {};\n", "utf8");
    await writeJson(join(packageRoot, "package.json"), packageManifest);
  }
  if (sync) {
    await syncLockstepVersions({ root, version: rootVersion });
  } else {
    await generateStarterPackageVersions({ root });
  }
  await generateStarterConfigs({ root });
  return root;
}

function manifest(name: string, overrides: Partial<PackageManifest> = {}): PackageManifest {
  const base: PackageManifest = {
    name,
    version: "0.5.0",
    private: false,
    type: "module",
    files: ["src"],
    exports: { ".": "./src/index.ts" },
    publishConfig: { access: "public" },
  };
  return { ...base, ...overrides };
}

function starterCompatibility(version: string): Readonly<Record<string, string>> {
  return {
    config: version,
    crypto: version,
    database: version,
    email: version,
    framework: version,
    frontend: version,
    http: version,
    i18n: version,
    runtime: version,
    view: version,
    websocket: version,
  };
}

async function planFor(
  root: string,
  options: ReleasePlannerOptions = { targetVersion: "0.5.0" },
  ...publishedMetadata: readonly (PublishedPackageMetadata & { readonly name: string })[]
): ReturnType<typeof createReleasePlan> {
  const packages = await discoverPublishablePackages(root);
  return createReleasePlan(root, packages, new FakeNpm({ published: publishedMetadata }), options);
}

function published(name: string, version: string, metadata: Partial<PublishedPackageMetadata> = {}): PublishedPackageMetadata & { readonly name: string } {
  return { name, exists: true, version, ...metadata };
}

class FakeNpm implements NpmClient {
  public readonly registry = "https://registry.test/";
  public readonly published: string[] = [];
  readonly #metadata = new Map<string, PublishedPackageMetadata>();
  readonly #failPublish: string | undefined;

  public constructor(options: Readonly<{ readonly published?: readonly (PublishedPackageMetadata & { readonly name: string })[]; readonly failPublish?: string }> = {}) {
    this.#failPublish = options.failPublish;
    for (const item of options.published ?? []) this.#metadata.set(`${item.name}@${item.version ?? "0.5.0"}`, item);
  }

  public metadata(name: string, version: string): Promise<PublishedPackageMetadata> {
    return Promise.resolve(this.#metadata.get(`${name}@${version}`) ?? { exists: false });
  }

  public versions(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  public whoami(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public publish(tarball: string, tag: string): Promise<void> {
    const name = tarball.includes("warblerjs-http") ? "@warblerjs/http" : "@warblerjs/core";
    this.published.push(`${name}:${tag}`);
    if (name === this.#failPublish) return Promise.reject(new ReleaseError(`publish failed for ${name}`));
    return Promise.resolve();
  }
}

function createCommandRunner(options: Readonly<{ readonly gitStatus?: string; readonly failWorkspaceTests?: boolean }> = {}): { readonly calls: string[]; readonly run: ReleaseCommandRunner } {
  const calls: string[] = [];
  return {
    calls,
    run(command, args) {
      const call = [command, ...args].join(" ");
      calls.push(call);
      if (call === "git status --short") {
        return Promise.resolve({ exitCode: 0, stdout: options.gitStatus ?? "", stderr: "" });
      }
      if (call === "bun test" && options.failWorkspaceTests === true) {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "root test failed" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, "utf8"));
}
