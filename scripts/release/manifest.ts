import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dependencyFields, releaseOrderDependencyFields, ReleaseError, staleWarblerScopes, WARBLER_SCOPE, type DependencyField, type PackageManifest } from "./types";
import { isWorkspaceRange } from "./semver";

export async function readManifest(path: string): Promise<PackageManifest> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value)) throw new ReleaseError(`Manifest root is not an object: ${path}`);
  return value as PackageManifest;
}

export async function writeManifest(path: string, manifest: PackageManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function internalDependencies(manifest: PackageManifest, packageNames: ReadonlySet<string>): readonly string[] {
  const result = new Set<string>();
  for (const field of releaseOrderDependencyFields) {
    const dependencies = dependencyRecord(manifest, field);
    for (const name of Object.keys(dependencies)) if (packageNames.has(name)) result.add(name);
  }
  return Object.freeze([...result].sort());
}

export function releaseManifest(
  manifest: PackageManifest,
  targetVersion: string,
  targetVersions: ReadonlyMap<string, string>,
): PackageManifest {
  const next: Record<string, unknown> = { ...manifest, version: targetVersion };
  delete next.devDependencies;
  for (const field of releaseOrderDependencyFields) {
    const dependencies = dependencyRecord(manifest, field);
    const resolved: Record<string, string> = {};
    let changed = false;
    for (const name of Object.keys(dependencies).sort()) {
      const range = dependencies[name]!;
      const dependencyTarget = targetVersions.get(name);
      if (dependencyTarget !== undefined) {
        resolved[name] = field === "peerDependencies" ? `^${dependencyTarget}` : dependencyTarget;
        changed = true;
      } else if (isWorkspaceRange(range)) {
        throw new ReleaseError(workspaceDependencyError(manifest, field, name));
      } else {
        resolved[name] = range;
      }
    }
    if (Object.keys(dependencies).length > 0 || changed) next[field] = Object.freeze(resolved);
    else delete next[field];
  }
  return Object.freeze(next) as PackageManifest;
}

export function dependencyRecord(manifest: PackageManifest, field: DependencyField): Readonly<Record<string, string>> {
  const value = manifest[field];
  return value === undefined ? Object.freeze({}) : value;
}

export function manifestHasWorkspaceProtocol(manifest: PackageManifest): boolean {
  return dependencyFields.some((field) => Object.values(dependencyRecord(manifest, field)).some(isWorkspaceRange));
}

export function manifestHasLocalDependencyReference(manifest: PackageManifest): boolean {
  return dependencyFields.some((field) => Object.values(dependencyRecord(manifest, field)).some(isLocalDependencyReference));
}

export function manifestHasStaleWarblerScope(manifest: PackageManifest): boolean {
  const text = JSON.stringify(manifest);
  return staleWarblerScopes.some((scope) => text.includes(scope));
}

export function assertPublishableManifest(manifest: PackageManifest, expectedName: string, expectedVersion: string): void {
  if (manifest.name !== expectedName) throw new ReleaseError(`Packed manifest name mismatch: expected ${expectedName}, got ${String(manifest.name)}`);
  if (!expectedName.startsWith(WARBLER_SCOPE)) throw new ReleaseError(`Package name must use ${WARBLER_SCOPE}: ${expectedName}`);
  if (manifest.version !== expectedVersion) throw new ReleaseError(`Packed manifest version mismatch for ${expectedName}: expected ${expectedVersion}, got ${String(manifest.version)}`);
  if (manifestHasWorkspaceProtocol(manifest)) throw new ReleaseError(`Packed manifest still contains workspace protocol: ${expectedName}@${expectedVersion}`);
  if (manifestHasLocalDependencyReference(manifest)) throw new ReleaseError(`Packed manifest contains a local dependency reference: ${expectedName}@${expectedVersion}`);
  if (manifestHasStaleWarblerScope(manifest)) throw new ReleaseError(`Packed manifest contains stale or malformed Warbler scope: ${expectedName}@${expectedVersion}`);
}

export function packageJsonPath(directory: string): string {
  return join(directory, "package.json");
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalDependencyReference(value: string): boolean {
  return value.startsWith("file:") || value.startsWith("link:") || value.startsWith("portal:") || value.startsWith("./") || value.startsWith("../");
}

function workspaceDependencyError(manifest: PackageManifest, field: DependencyField, dependencyName: string): string {
  const owner = typeof manifest.name === "string" ? `${manifest.name}: ` : "";
  return `${owner}${field}.${dependencyName} uses a workspace protocol but is not part of the release target set.`;
}
