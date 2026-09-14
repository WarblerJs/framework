#!/usr/bin/env bun
import { discoverPublishablePackages } from "./release/discovery";
import { packReleasePackage } from "./release/package";
import { createReleasePlan, targetVersionMap } from "./release/planner";
import { readCanonicalReleaseVersion } from "./release/version";
import { smokePackedTarballs } from "./release/smoke";
import { ReleaseError, type NpmClient, type PackedPackage, type PublishedPackageMetadata } from "./release/types";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");

try {
  const canonical = await readCanonicalReleaseVersion(root);
  const packages = await discoverPublishablePackages(root);
  const plan = await createReleasePlan(root, packages, new EmptyNpm(), { targetVersion: canonical.version });
  const targets = targetVersionMap(plan);
  const packed: PackedPackage[] = [];
  for (const item of plan.packages) {
    const workspace = packages.find((candidate) => candidate.name === item.name);
    if (workspace === undefined) throw new ReleaseError(`Release package is missing from workspace: ${item.name}`);
    const tarball = await packReleasePackage(root, workspace, item, targets);
    packed.push(tarball);
    console.log(`packed ${item.name}@${tarball.version}`);
  }
  await smokePackedTarballs(root, packed);
  for (const item of plan.packages) console.log(`imported ${item.name}`);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : "Unknown packed package smoke failure");
  process.exit(1);
}

class EmptyNpm implements NpmClient {
  public readonly registry = "https://registry.test/";
  public metadata(): Promise<PublishedPackageMetadata> { return Promise.resolve({ exists: false }); }
  public versions(): Promise<readonly string[]> { return Promise.resolve([]); }
  public whoami(): Promise<boolean> { return Promise.resolve(false); }
  public publish(): Promise<void> { throw new ReleaseError("Smoke test must not publish."); }
}
