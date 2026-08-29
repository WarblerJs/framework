import { discoverPublishablePackages } from "./discovery";
import { assertPublishableManifest, readManifest } from "./manifest";
import { packReleasePackage, runPackageTypecheck } from "./package";
import { createReleasePlan, targetVersionMap } from "./planner";
import { RegistryNpmClient } from "./npm-client";
import { ReleaseError, type NpmClient, type PackedPackage, type ReleaseCommandResult, type ReleaseCommandRunner, type ReleaseOptions, type ReleasePackage, type ReleasePlan, type ReleaseResult, type WorkspacePackage } from "./types";
import { readCanonicalReleaseVersion, releaseTag } from "./version";
import { syncLockstepVersions } from "./sync";
import { smokePackedTarballs } from "./smoke";
import { generateStarterConfigs } from "../../packages/cli/scripts/generate-starter-configs";

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
export { discoverWorkspacePackages } from "./discovery";
export { resolveWorkspaceRange, npmTag, assertSemver, compareSemver } from "./semver";
export { assertPublishableManifest, releaseManifest, manifestHasLocalDependencyReference, manifestHasWorkspaceProtocol } from "./manifest";
export { readCanonicalReleaseVersion, releaseTag, type WarblerReleaseVersion } from "./version";
export { smokePackedTarballs } from "./smoke";

export async function runRelease(options: ReleaseOptions): Promise<ReleaseResult> {
  const npm = options.npm ?? new RegistryNpmClient(options.registry);
  const runCommand = options.runCommand ?? runReleaseCommand;
  if (!options.dryRun && options.allowDirty === true) throw new ReleaseError("--allow-dirty may only be used with --dry-run.");
  if (!options.dryRun && options.noTests === true) throw new ReleaseError("--no-tests may only be used with --dry-run.");
  if (options.allowDirty !== true) await assertCleanGit(options.root, runCommand);
  if (!options.dryRun && !await npm.whoami()) throw new ReleaseError("npm authentication is required before publishing.");
  const canonical = await readCanonicalReleaseVersion(options.root);
  if (options.targetVersion !== canonical.version) {
    throw new ReleaseError(`Release target must match canonical Warbler version: expected ${canonical.version}, got ${options.targetVersion}`);
  }
  await syncLockstepVersions({ root: options.root, check: true });
  await generateStarterConfigs({ root: options.root, check: true });

  const workspacePackages = await discoverPublishablePackages(options.root);
  const byName = new Map(workspacePackages.map((item) => [item.name, item] as const));
  const plan = await createReleasePlan(options.root, workspacePackages, npm, { targetVersion: options.targetVersion });
  await options.onPlan?.(plan);
  if (plan.staleReferences.length > 0) {
    const first = plan.staleReferences[0]!;
    throw new ReleaseError(`Stale Warbler scope reference found: ${first.file}:${first.line} (${first.value})`);
  }

  const targetVersions = targetVersionMap(plan);
  const packedPackages: PackedPackage[] = [];
  const planned: string[] = [];
  const skipped: string[] = [];

  for (const item of plan.packages) {
    if (item.shouldPublish) planned.push(`${item.name}@${item.targetVersion}`);
    else skipped.push(`${item.name}@${item.targetVersion}`);
  }

  if (options.noTests !== true) {
    await options.progress?.("Testing workspace");
    await runWorkspaceTests(options.root, runCommand);
  }

  await options.progress?.("Typechecking packages");
  for (const item of plan.packages) {
    const workspacePackage = byName.get(item.name);
    if (workspacePackage === undefined) throw new ReleaseError(`Package missing from workspace map: ${item.name}`);
    if (!item.shouldPublish) continue;
    await runPackageTypecheck(workspacePackage, runCommand);
  }

  await options.progress?.("Packing packages");
  for (const item of plan.packages) {
    const workspacePackage = byName.get(item.name);
    if (workspacePackage === undefined) throw new ReleaseError(`Package missing from workspace map: ${item.name}`);
    if (!item.shouldPublish) continue;
    const packed = await packReleasePackage(workspacePackage, item, targetVersions);
    packedPackages.push(packed);
  }

  await options.progress?.("Validating packed manifests");
  validatePackedManifests(plan, packedPackages);
  await options.progress?.("Smoke-testing packed imports");
  await smokePackedTarballs(options.root, packedPackages);

  const published: string[] = [];
  if (!options.dryRun) {
    for (let index = 0, length = plan.packages.length; index < length; index += 1) {
      const item = plan.packages[index]!;
      if (!item.shouldPublish) continue;
      const packed = packedPackages.find((candidate) => candidate.packageName === item.name);
      if (packed === undefined) throw new ReleaseError(`Packed tarball missing for ${item.name}@${item.targetVersion}`);
      await assertInternalDependencyVersionsAvailable(item, plan, npm, published, skipped);
      await npm.publish(packed.tarball, item.npmTag);
      published.push(`${item.name}@${item.targetVersion}`);
    }
  }

  return Object.freeze({
    planned: Object.freeze(planned),
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

function validatePackedManifests(plan: ReleasePlan, packedPackages: readonly PackedPackage[]): void {
  for (const item of plan.packages) {
    if (!item.shouldPublish) continue;
    const packed = packedPackages.find((candidate) => candidate.packageName === item.name);
    if (packed === undefined) throw new ReleaseError(`Packed tarball missing for ${item.name}@${item.targetVersion}`);
    assertPublishableManifest(packed.manifest, item.name, item.targetVersion);
  }
}

async function runWorkspaceTests(root: string, runCommand: ReleaseCommandRunner): Promise<void> {
  const result = await runCommand("bun", ["test"], { cwd: root });
  if (result.exitCode !== 0) throw new ReleaseError(`Workspace tests failed: ${result.stderr.trim() || result.stdout.trim()}`);
}

async function assertCleanGit(root: string, runCommand: ReleaseCommandRunner): Promise<void> {
  const result = await runCommand("git", ["status", "--short"], { cwd: root });
  if (result.exitCode !== 0) throw new ReleaseError(`Unable to inspect git status: ${result.stderr.trim()}`);
  if (result.stdout.trim().length > 0) throw new ReleaseError("Release requires a clean git working tree. Use --allow-dirty only with --dry-run while developing release changes.");
}

async function runReleaseCommand(command: string, args: readonly string[], options: { readonly cwd: string }): Promise<ReleaseCommandResult> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

export function formatPlan(plan: ReleasePlan): string {
  const version = plan.packages[0]?.targetVersion ?? "unknown";
  const rows = [`Warbler release ${version}`, `Git tag ${releaseTag(version)}`, ""];
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
