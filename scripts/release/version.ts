import { readManifest } from "./manifest";
import { assertSemver } from "./semver";
import { ReleaseError } from "./types";

export interface WarblerReleaseVersion {
  readonly version: string;
}

export async function readCanonicalReleaseVersion(root: string): Promise<WarblerReleaseVersion> {
  const manifest = await readManifest(`${root.replace(/\/+$/u, "")}/package.json`);
  if (manifest.name !== "warbler") {
    throw new ReleaseError("Root package manifest must be named warbler.");
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new ReleaseError("Root package manifest requires the canonical Warbler version.");
  }
  assertSemver(manifest.version);
  return Object.freeze({ version: manifest.version });
}

export function releaseTag(version: string): string {
  assertSemver(version);
  return `v${version}`;
}
