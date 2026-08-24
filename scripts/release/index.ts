import { discoverPublishablePackages } from "./discovery";
import { readManifest } from "./manifest";
import { packReleasePackage, runPackageTypecheck } from "./package";
import { createReleasePlan, targetVersionMap } from "./planner";
import { RegistryNpmClient } from "./npm-client";
import { ReleaseError, type NpmClient, type ReleaseOptions, type ReleasePackage, type ReleasePlan, type ReleaseResult, type WorkspacePackage } from "./types";

export type {
  NpmClient,
  PublishedPackageMetadata,
  ReleaseOptions,
  ReleasePackage,
  ReleaseReason,
  ReleasePlan,
  ReleaseResult,
  ExplicitReleaseRequest,
  WorkspacePackage,
} from "./types";
export { ReleaseError } from "./types";
export { createReleasePlan } from "./planner";
export { discoverPublishablePackages, scanStaleWarblerReferences } from "./discovery";
export { resolveWorkspaceRange, npmTag, bumpRepairVersion, bumpStablePatchVersion } from "./semver";
export { assertPublishableManifest, releaseManifest } from "./manifest";

export async function runRelease(options: ReleaseOptions): Promise<ReleaseResult> {
  const npm = options.npm ?? new RegistryNpmClient(options.registry);
  if (!options.dryRun && !options.allowDirty) await assertCleanGit(options.root);
  if (!options.dryRun && !await npm.whoami()) throw new ReleaseError("npm authentication is required before publishing.");

  const workspacePackages = await discoverPublishablePackages(options.root);
  const byName = new Map(workspacePackages.map((item) => [item.name, item] as const));
  const plan = await createReleasePlan(options.root, workspacePackages, npm, {
    ...(options.packageName === undefined ? {} : { packageName: options.packageName }),
    ...(options.fromPackage === undefined ? {} : { fromPackage: options.fromPackage }),
    ...(options.explicitReleases === undefined ? {} : { explicitReleases: options.explicitReleases }),
  });
  if (plan.staleReferences.length > 0) {
    const first = plan.staleReferences[0]!;
    throw new ReleaseError(`Stale Warbler scope reference found: ${first.file}:${first.line} (${first.value})`);
  }

  const targetVersions = targetVersionMap(plan);
  const published: string[] = [];
  const skipped: string[] = [];

  for (const item of plan.packages) {
    const workspacePackage = byName.get(item.name);
    if (workspacePackage === undefined) throw new ReleaseError(`Package missing from workspace map: ${item.name}`);
    if (!item.shouldPublish) {
      skipped.push(`${item.name}@${item.targetVersion}`);
      continue;
    }
    if (options.noTests !== true) await runPackageTypecheck(workspacePackage);
    const packed = await packReleasePackage(workspacePackage, item, targetVersions);
    await assertInternalDependencyVersionsAvailable(item, plan, npm, published, skipped);
    if (!options.dryRun) await npm.publish(packed.tarball, item.npmTag);
    published.push(`${item.name}@${item.targetVersion}`);
  }

  return Object.freeze({
    published: Object.freeze(published),
    skipped: Object.freeze(skipped),
  });
}

export async function loadPackedManifest(path: string): Promise<Readonly<Record<string, unknown>>> {
  return readManifest(path);
}

async function assertInternalDependencyVersionsAvailable(
  item: ReleasePackage,
  plan: ReleasePlan,
  npm: NpmClient,
  published: readonly string[],
  skipped: readonly string[],
): Promise<void> {
  const available = new Set([...published, ...skipped]);
  for (const dependency of item.internalDependencies) {
    const dep = plan.packages.find((candidate) => candidate.name === dependency);
    if (dep === undefined) continue;
    const key = `${dep.name}@${dep.targetVersion}`;
    if (available.has(key)) continue;
    if ((await npm.metadata(dep.name, dep.targetVersion)).exists) continue;
    throw new ReleaseError(`${item.name}@${item.targetVersion} depends on ${key}, which is not available before publish.`);
  }
}

async function assertCleanGit(root: string): Promise<void> {
  const proc = Bun.spawn(["git", "status", "--short"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new ReleaseError(`Unable to inspect git status: ${stderr.trim()}`);
  if (stdout.trim().length > 0) throw new ReleaseError("Real publish requires a clean git working tree. Use --dry-run while developing release changes.");
}

export function formatPlan(plan: ReleasePlan): string {
  const rows = ["Warbler release", ""];
  for (const item of plan.packages) {
    const marker = item.shouldPublish ? "PUBLISH" : "SKIP";
    const version = item.currentVersion === item.targetVersion
      ? item.targetVersion
      : `${item.currentVersion} -> ${item.targetVersion}`;
    rows.push(`${marker.padEnd(7)} ${item.name}@${version} (${formatReason(item.reason)}, tag ${item.npmTag})`);
  }
  return rows.join("\n");
}

function formatReason(reason: string): string {
  return reason.replace(/-/gu, " ");
}
