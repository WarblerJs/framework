import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packageJsonPath, readManifest } from "./manifest";
import { ReleaseError, staleWarblerScopes, WARBLER_SCOPE, type StaleReference, type WorkspacePackage } from "./types";

export async function discoverPublishablePackages(root: string): Promise<readonly WorkspacePackage[]> {
  const packagesRoot = join(root, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesRoot, entry.name);
    const manifestPath = packageJsonPath(directory);
    if (!await exists(manifestPath)) continue;
    const manifest = await readManifest(manifestPath);
    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new ReleaseError(`Publishable package requires name and version: ${manifestPath}`);
    }
    if (!manifest.name.startsWith(WARBLER_SCOPE)) {
      throw new ReleaseError(`Publishable package uses unsupported scope: ${manifest.name}`);
    }
    packages.push(Object.freeze({
      name: manifest.name,
      directory,
      manifestPath,
      manifest,
      currentVersion: manifest.version,
    }));
  }
  return Object.freeze(packages.sort((left, right) => left.name.localeCompare(right.name)));
}

export async function scanStaleWarblerReferences(root: string): Promise<readonly StaleReference[]> {
  const targets = [
    "package.json",
    "README.md",
    "docs",
    "packages",
    "playground",
  ];
  const files: string[] = [];
  for (const target of targets) await collectFiles(resolve(root, target), files);
  const findings: StaleReference[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      for (const scope of staleWarblerScopes) {
        if (line.includes(scope)) findings.push(Object.freeze({ file, line: index + 1, value: scope }));
      }
    }
  }
  return Object.freeze(findings);
}

async function collectFiles(path: string, output: string[]): Promise<void> {
  if (!await exists(path)) return;
  const details = await stat(path);
  if (details.isFile()) {
    if (isTextPath(path)) output.push(path);
    return;
  }
  if (!details.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".warbler" || entry.name === "dist" || entry.name === "generated" || entry.name.startsWith(".cli-test-")) continue;
    await collectFiles(join(path, entry.name), output);
  }
}

function isTextPath(path: string): boolean {
  return /\.(?:json|md|ts|tsx|js|mjs|cjs|html|css|txt)$/u.test(path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}
