import { topologicalOrder } from "./graph";
import { dependencyRecord, internalDependencies, manifestHasStaleWarblerScope, manifestHasWorkspaceProtocol, releaseManifest } from "./manifest";
import { bumpStablePatchVersion, firstUnpublishedRepairVersion, npmTag } from "./semver";
import { scanStaleWarblerReferences } from "./discovery";
import {
  dependencyFields,
  ReleaseError,
  WARBLER_SCOPE,
  type NpmClient,
  type ReleasePackage,
  type ReleasePlan,
  type ReleasePlannerOptions,
  type ReleaseReason,
  type WorkspacePackage,
} from "./types";

interface PackageState {
  readonly package: WorkspacePackage;
  readonly currentMetadata: Readonly<{ readonly exists: boolean; readonly dependencies?: Readonly<Record<string, string>>; readonly optionalDependencies?: Readonly<Record<string, string>>; readonly peerDependencies?: Readonly<Record<string, string>> }>;
  readonly publishedCurrent: boolean;
  readonly publishedCurrentBroken: boolean;
  readonly publishedVersions: readonly string[];
}

export async function createReleasePlan(
  root: string,
  packages: readonly WorkspacePackage[],
  npm: NpmClient,
  options: ReleasePlannerOptions = {},
): Promise<ReleasePlan> {
  const explicitReleases = options.explicitReleases ?? [];
  if (explicitReleases.length > 0 && (options.packageName !== undefined || options.fromPackage !== undefined)) {
    throw new ReleaseError("--patch cannot be combined with --package or --from because dependent propagation requires the full workspace graph.");
  }
  const ordered = filterPackages(topologicalOrder(packages), options);
  const allByName = new Map(packages.map((item) => [item.name, item] as const));
  validateExplicitReleases(explicitReleases, allByName);
  const packageNames = new Set(packages.map((item) => item.name));
  const states = new Map<string, PackageState>();
  for (const item of ordered) {
    const [metadata, versions] = await Promise.all([
      npm.metadata(item.name, item.currentVersion),
      npm.versions(item.name),
    ]);
    states.set(item.name, Object.freeze({
      package: item,
      currentMetadata: metadata,
      publishedCurrent: metadata.exists,
      publishedCurrentBroken: metadata.exists && publishedMetadataBroken(metadata),
      publishedVersions: versions,
    }));
  }

  const targets = new Map<string, string>();
  const reasons = new Map<string, ReleaseReason>();
  const explicitNames = new Set(explicitReleases.map((item) => item.packageName));
  for (const item of ordered) {
    const state = states.get(item.name)!;
    if (explicitNames.has(item.name)) {
      targets.set(item.name, bumpStablePatchVersion(item.currentVersion));
      reasons.set(item.name, "explicit-patch");
    } else if (state.publishedCurrentBroken) {
      targets.set(item.name, firstUnpublishedRepairVersion(item.currentVersion, state.publishedVersions));
      reasons.set(item.name, "metadata-repair");
    } else {
      targets.set(item.name, item.currentVersion);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const item of ordered) {
      const state = states.get(item.name)!;
      const desired = releaseManifest(item.manifest, targets.get(item.name)!, targets);
      const desiredDiffers = state.publishedCurrent && !publishedDependenciesMatch(desired, state.currentMetadata);
      if (desiredDiffers && targets.get(item.name) === item.currentVersion) {
        targets.set(item.name, firstUnpublishedRepairVersion(item.currentVersion, state.publishedVersions));
        reasons.set(item.name, "dependency-propagation");
        changed = true;
      }
    }
  }

  const planned: ReleasePackage[] = [];
  for (const item of ordered) {
    const state = states.get(item.name)!;
    const targetVersion = targets.get(item.name)!;
    const metadata = await npm.metadata(item.name, targetVersion);
    const shouldPublish = !metadata.exists;
    if (metadata.exists && targetVersion !== item.currentVersion) {
      throw new ReleaseError(`Release target already exists and cannot be overwritten: ${item.name}@${targetVersion}`);
    }
    planned.push(Object.freeze({
      name: item.name,
      directory: item.directory,
      currentVersion: item.currentVersion,
      targetVersion,
      npmTag: npmTag(targetVersion),
      internalDependencies: internalDependencies(item.manifest, packageNames),
      shouldPublish,
      reason: shouldPublish
        ? reasons.get(item.name) ?? "not-published"
        : "already-published",
    }));
  }

  return Object.freeze({
    packages: Object.freeze(planned),
    staleReferences: await scanStaleWarblerReferences(root),
  });
}

export function targetVersionMap(plan: ReleasePlan): ReadonlyMap<string, string> {
  return new Map(plan.packages.map((item) => [item.name, item.targetVersion] as const));
}

export function assertDependencyAvailability(plan: ReleasePlan, alreadyPublished: ReadonlySet<string>): void {
  const available = new Set(alreadyPublished);
  for (const item of plan.packages) {
    for (const dependency of item.internalDependencies) {
      const dep = plan.packages.find((candidate) => candidate.name === dependency);
      if (dep === undefined) continue;
      const key = `${dep.name}@${dep.targetVersion}`;
      if (!available.has(key)) throw new ReleaseError(`${item.name}@${item.targetVersion} depends on ${key}, which is not published or scheduled earlier.`);
    }
    available.add(`${item.name}@${item.targetVersion}`);
  }
}

function filterPackages(packages: readonly WorkspacePackage[], filter: Readonly<{ readonly packageName?: string; readonly fromPackage?: string }>): readonly WorkspacePackage[] {
  if (filter.packageName !== undefined) return Object.freeze(packages.filter((item) => item.name === filter.packageName));
  if (filter.fromPackage !== undefined) {
    const index = packages.findIndex((item) => item.name === filter.fromPackage);
    if (index < 0) throw new ReleaseError(`--from package was not discovered: ${filter.fromPackage}`);
    return Object.freeze(packages.slice(index));
  }
  return packages;
}

function validateExplicitReleases(
  requests: readonly Readonly<{ readonly packageName: string; readonly bump: "patch" }>[],
  packages: ReadonlyMap<string, WorkspacePackage>,
): void {
  const seen = new Set<string>();
  for (const request of requests) {
    if (!request.packageName.startsWith(WARBLER_SCOPE)) {
      throw new ReleaseError(`Explicit patch package must use ${WARBLER_SCOPE}: ${request.packageName}`);
    }
    if (request.bump !== "patch") throw new ReleaseError(`Unsupported explicit release bump: ${request.bump}`);
    if (seen.has(request.packageName)) continue;
    seen.add(request.packageName);
    const item = packages.get(request.packageName);
    if (item === undefined) throw new ReleaseError(`Explicit patch package was not discovered or is private: ${request.packageName}`);
  }
}

function publishedMetadataBroken(metadata: Readonly<{ readonly dependencies?: Readonly<Record<string, string>>; readonly optionalDependencies?: Readonly<Record<string, string>>; readonly peerDependencies?: Readonly<Record<string, string>> }>): boolean {
  return manifestHasWorkspaceProtocol(metadata) || manifestHasStaleWarblerScope(metadata);
}

function publishedDependenciesMatch(manifest: Readonly<{ readonly dependencies?: Readonly<Record<string, string>>; readonly optionalDependencies?: Readonly<Record<string, string>>; readonly peerDependencies?: Readonly<Record<string, string>> }>, metadata: Readonly<{ readonly exists: boolean; readonly dependencies?: Readonly<Record<string, string>>; readonly optionalDependencies?: Readonly<Record<string, string>>; readonly peerDependencies?: Readonly<Record<string, string>> }>): boolean {
  if (!metadata.exists) return false;
  for (const field of dependencyFields) {
    if (!recordsEqual(dependencyRecord(manifest, field), dependencyRecord(metadata, field))) return false;
  }
  return true;
}

function recordsEqual(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
