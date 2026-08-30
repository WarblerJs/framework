import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packageJsonPath, readManifest } from "./manifest";
import { ReleaseError, staleWarblerScopes, WARBLER_SCOPE, type StaleReference, type WorkspacePackage } from "./types";

export async function discoverWorkspacePackages(root: string): Promise<readonly WorkspacePackage[]> {
  const rootManifest = await readManifest(packageJsonPath(root));
  const workspaces = rootManifest.workspaces;
  if (!Array.isArray(workspaces)) throw new ReleaseError("Root package manifest requires a workspaces array.");
  const packages: WorkspacePackage[] = [];
  for (const workspace of workspaces) {
    if (typeof workspace !== "string" || workspace.length === 0) throw new ReleaseError("Root workspaces must be non-empty strings.");
    await collectWorkspacePackages(root, workspace, packages);
  }
  packages.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze(packages);
}

export async function discoverPublishablePackages(root: string): Promise<readonly WorkspacePackage[]> {
  const workspaces = await discoverWorkspacePackages(root);
  const packages: WorkspacePackage[] = [];
  for (const item of workspaces) {
    const manifest = item.manifest;
    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new ReleaseError(`Publishable package requires name and version: ${item.manifestPath}`);
    }
    if (!manifest.name.startsWith(WARBLER_SCOPE)) {
      throw new ReleaseError(`Publishable package uses unsupported scope: ${manifest.name}`);
    }
    if (manifest.publishConfig?.access !== "public") throw new ReleaseError(`Publishable package requires publishConfig.access public: ${manifest.name}`);
    packages.push(item);
  }
  return Object.freeze(packages);
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

async function collectWorkspacePackages(root: string, workspace: string, output: WorkspacePackage[]): Promise<void> {
  if (workspace.includes("..") || workspace.startsWith("/") || workspace.includes("\\")) {
    throw new ReleaseError(`Unsupported workspace path outside repository boundary: ${workspace}`);
  }
  if (workspace.endsWith("/*")) {
    const base = resolve(root, workspace.slice(0, -2));
    if (!base.startsWith(resolve(root))) throw new ReleaseError(`Workspace path escapes repository: ${workspace}`);
    const entries = await readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await appendWorkspacePackage(join(base, entry.name), output);
    }
    return;
  }
  await appendWorkspacePackage(resolve(root, workspace), output);
}

async function appendWorkspacePackage(directory: string, output: WorkspacePackage[]): Promise<void> {
  const manifestPath = packageJsonPath(directory);
  if (!await exists(manifestPath)) return;
  const manifest = await readManifest(manifestPath);
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new ReleaseError(`Workspace package requires name and version: ${manifestPath}`);
  }
  output.push(Object.freeze({
    name: manifest.name,
    directory,
    manifestPath,
    manifest,
    currentVersion: manifest.version,
    private: manifest.private === true,
  }));
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
