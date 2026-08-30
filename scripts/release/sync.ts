import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateStarterPackageVersions, renderGeneratedFile, STARTER_PACKAGE_DESCRIPTORS } from "../../packages/cli/scripts/generate-starter-package-versions";
import { discoverWorkspacePackages } from "./discovery";
import { dependencyFields, ReleaseError, WARBLER_SCOPE, type DependencyField, type PackageManifest, type WorkspacePackage } from "./types";
import { packageJsonPath, readManifest, writeManifest } from "./manifest";
import { assertSemver, compareSemver } from "./semver";

export interface SyncVersionOptions {
  readonly root: string;
  readonly version?: string;
  readonly check?: boolean;
}

export interface SyncVersionResult {
  readonly version: string;
  readonly changed: boolean;
  readonly drift: readonly string[];
}

export async function syncLockstepVersions(options: SyncVersionOptions): Promise<SyncVersionResult> {
  const root = options.root.replace(/\/+$/u, "");
  const rootManifestPath = packageJsonPath(root);
  const rootManifest = await readManifest(rootManifestPath);
  if (rootManifest.name !== "warbler") throw new ReleaseError("Root package manifest must be named warbler.");
  if (typeof rootManifest.version !== "string") throw new ReleaseError("Root package manifest requires a canonical version.");
  const version = options.version ?? rootManifest.version;
  assertSemver(version);
  if (options.version !== undefined && version !== rootManifest.version && compareSemver(version, rootManifest.version) <= 0) {
    throw new ReleaseError(`Release version must be greater than the current canonical version: ${version} <= ${rootManifest.version}`);
  }

  const workspaces = await discoverWorkspacePackages(root);
  const workspaceNames = new Set(workspaces.map((item) => item.name));
  const drift: string[] = [];
  let changed = false;

  const nextRoot = { ...rootManifest, version };
  changed = collectManifestDrift(rootManifestPath, rootManifest, nextRoot, drift) || changed;
  if (options.check !== true && rootManifest.version !== version) await writeManifest(rootManifestPath, nextRoot);

  for (const item of workspaces) {
    const next = synchronizedManifest(item, version, workspaceNames);
    const manifestChanged = collectManifestDrift(item.manifestPath, item.manifest, next, drift);
    changed = manifestChanged || changed;
    if (options.check !== true && manifestChanged) await writeManifest(item.manifestPath, next);
  }

  const compatibilityPath = join(root, "packages/cli/starter-compatibility.json");
  const compatibility = await readManifest(compatibilityPath);
  const nextCompatibility = synchronizedStarterCompatibility(compatibility, version);
  changed = collectManifestDrift(compatibilityPath, compatibility, nextCompatibility, drift) || changed;
  if (options.check !== true && JSON.stringify(compatibility) !== JSON.stringify(nextCompatibility)) {
    await writeManifest(compatibilityPath, nextCompatibility);
  }

  const generatedPath = join(root, "packages/cli/src/new/starter-package-versions.generated.ts");
  const expectedGenerated = renderGeneratedFile(nextCompatibility as Readonly<Record<string, string>>);
  let currentGenerated = "";
  try { currentGenerated = await readFile(generatedPath, "utf8"); } catch { currentGenerated = ""; }
  if (currentGenerated !== expectedGenerated) {
    drift.push(`${generatedPath}: starter package version metadata is stale`);
    changed = true;
  }

  if (options.check === true) {
    if (drift.length > 0) throw new ReleaseError(`Lockstep version drift detected:\n${drift.join("\n")}`);
    await generateStarterPackageVersions({ root, check: true });
    return Object.freeze({ version, changed: false, drift: Object.freeze([]) });
  }

  await generateStarterPackageVersions({ root });
  return Object.freeze({ version, changed, drift: Object.freeze(drift) });
}

function synchronizedManifest(
  item: WorkspacePackage,
  version: string,
  workspaceNames: ReadonlySet<string>,
): PackageManifest {
  const next: Record<string, unknown> = { ...item.manifest };
  if (!item.private) {
    if (!item.name.startsWith(WARBLER_SCOPE)) throw new ReleaseError(`Publishable package uses unsupported scope: ${item.name}`);
    next.version = version;
    next.publishConfig = { ...item.manifest.publishConfig, access: "public" };
  }
  for (const field of dependencyFields) {
    const dependencies = item.manifest[field];
    if (dependencies === undefined) continue;
    next[field] = synchronizeDependencyRecord(dependencies, workspaceNames);
  }
  return next as PackageManifest;
}

function synchronizeDependencyRecord(
  dependencies: Readonly<Record<string, string>>,
  workspaceNames: ReadonlySet<string>,
): Readonly<Record<string, string>> {
  const next: Record<string, string> = {};
  for (const name of Object.keys(dependencies).sort()) {
    next[name] = workspaceNames.has(name) ? "workspace:*" : dependencies[name]!;
  }
  return next;
}

function synchronizedStarterCompatibility(
  manifest: Readonly<Record<string, unknown>>,
  version: string,
): Readonly<Record<string, string>> {
  const next: Record<string, string> = {};
  for (const descriptor of STARTER_PACKAGE_DESCRIPTORS) {
    next[descriptor.key] = version;
  }
  for (const key of Object.keys(manifest)) {
    if (next[key] === undefined) throw new ReleaseError(`Starter compatibility catalog contains unsupported package: ${key}`);
  }
  return next;
}

function collectManifestDrift(
  path: string,
  current: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
  drift: string[],
): boolean {
  const currentText = JSON.stringify(current, null, 2);
  const expectedText = JSON.stringify(expected, null, 2);
  if (currentText === expectedText) return false;
  collectVersionDrift(path, current, expected, drift);
  collectDependencyDrift(path, current, expected, drift);
  return true;
}

function collectVersionDrift(
  path: string,
  current: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
  drift: string[],
): void {
  if (current.version !== expected.version) {
    drift.push(`${path}: version expected ${String(expected.version)}, got ${String(current.version)}`);
  }
  const currentPublish = current.publishConfig;
  const expectedPublish = expected.publishConfig;
  if (JSON.stringify(currentPublish) !== JSON.stringify(expectedPublish)) {
    drift.push(`${path}: publishConfig expected ${JSON.stringify(expectedPublish)}, got ${JSON.stringify(currentPublish)}`);
  }
}

function collectDependencyDrift(
  path: string,
  current: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
  drift: string[],
): void {
  for (const field of dependencyFields) {
    const currentRecord = record(current[field]);
    const expectedRecord = record(expected[field]);
    for (const name of Object.keys(expectedRecord)) {
      if (currentRecord[name] !== expectedRecord[name]) {
        drift.push(`${path}: ${field}.${name} expected ${expectedRecord[name]}, got ${String(currentRecord[name])}`);
      }
    }
  }
}

function record(value: unknown): Readonly<Record<string, string>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, string>>
    : {};
}
