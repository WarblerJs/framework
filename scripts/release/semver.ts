import { ReleaseError } from "./types";

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/u;

export function npmTag(version: string): string {
  const parsed = parseSemver(version);
  if (parsed.prerelease === undefined) return "latest";
  const tag = parsed.prerelease.split(".")[0]!;
  return /^[A-Za-z][A-Za-z0-9-]*$/u.test(tag) ? tag : "next";
}

export function bumpRepairVersion(version: string): string {
  const parsed = parseSemver(version);
  if (parsed.prerelease === undefined) return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  const parts = parsed.prerelease.split(".");
  const last = parts[parts.length - 1]!;
  if (/^\d+$/u.test(last)) {
    const next = `${Number(last) + 1}`;
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-${[...parts.slice(0, -1), next].join(".")}`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-${parsed.prerelease}.1`;
}

export function firstUnpublishedRepairVersion(current: string, publishedVersions: readonly string[]): string {
  const published = new Set(publishedVersions);
  let candidate = bumpRepairVersion(current);
  while (published.has(candidate)) candidate = bumpRepairVersion(candidate);
  return candidate;
}

export function resolveWorkspaceRange(range: string, targetVersion: string): string {
  if (range === "workspace:*") return targetVersion;
  if (range === "workspace:^") return `^${targetVersion}`;
  if (range === "workspace:~") return `~${targetVersion}`;
  throw new ReleaseError(`Unsupported workspace protocol: ${range}`);
}

export function isWorkspaceRange(value: string): boolean {
  return value.startsWith("workspace:");
}

function parseSemver(version: string): ParsedSemver {
  const match = SEMVER.exec(version);
  if (match === null) throw new ReleaseError(`Invalid semver version: ${version}`);
  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  });
}
