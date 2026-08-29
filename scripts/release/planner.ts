import { topologicalOrder } from "./graph";
import { internalDependencies } from "./manifest";
import { npmTag } from "./semver";
import { scanStaleWarblerReferences } from "./discovery";
import { ReleaseError, type NpmClient, type ReleasePackage, type ReleasePlan, type ReleasePlannerOptions, type WorkspacePackage } from "./types";

export async function createReleasePlan(
  root: string,
  packages: readonly WorkspacePackage[],
  npm: NpmClient,
  options: ReleasePlannerOptions,
): Promise<ReleasePlan> {
  const ordered = topologicalOrder(packages);
  const names = new Set(packages.map((item) => item.name));
  const planned: ReleasePackage[] = [];
  for (const item of ordered) {
    if (item.currentVersion !== options.targetVersion) {
      throw new ReleaseError(`Package version drift: ${item.name} expected ${options.targetVersion}, got ${item.currentVersion}`);
    }
    const metadata = await npm.metadata(item.name, options.targetVersion);
    if (metadata.exists) throw new ReleaseError(`Release target already exists and cannot be overwritten: ${item.name}@${options.targetVersion}`);
    planned.push(Object.freeze({
      name: item.name,
      directory: item.directory,
      currentVersion: item.currentVersion,
      targetVersion: options.targetVersion,
      npmTag: npmTag(options.targetVersion),
      internalDependencies: internalDependencies(item.manifest, names),
      shouldPublish: true,
      reason: "lockstep-release",
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
