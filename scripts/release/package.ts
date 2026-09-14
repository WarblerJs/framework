import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertPublishableManifest, releaseManifest, writeManifest } from "./manifest";
import { ReleaseError, type PackedPackage, type PackageManifest, type ReleaseCommandResult, type ReleaseCommandRunner, type ReleasePackage, type WorkspacePackage } from "./types";

export async function packReleasePackage(
  root: string,
  workspacePackage: WorkspacePackage,
  releasePackage: ReleasePackage,
  targetVersions: ReadonlyMap<string, string>,
): Promise<PackedPackage> {
  const license = await readRootLicense(root);
  const stage = await mkdtemp(join(tmpdir(), "warbler-release-stage-"));
  await stagePackage(workspacePackage.directory, stage, workspacePackage.manifest.files);
  await writeFile(join(stage, "LICENSE"), license, "utf8");
  const manifest = releaseManifest(workspacePackage.manifest, releasePackage.targetVersion, targetVersions);
  await writeManifest(join(stage, "package.json"), manifest);
  const tarball = await pack(stage);
  await assertPackedLicense(tarball, license);
  const packedManifest = await packedPackageJson(tarball);
  assertPublishableManifest(packedManifest, releasePackage.name, releasePackage.targetVersion);
  return Object.freeze({
    packageName: releasePackage.name,
    version: releasePackage.targetVersion,
    tarball,
    manifest: packedManifest,
  });
}

async function readRootLicense(root: string): Promise<string> {
  try {
    return await readFile(join(root, "LICENSE"), "utf8");
  } catch {
    throw new ReleaseError("Root LICENSE is required to pack release packages.");
  }
}

export async function runPackageTypecheck(item: WorkspacePackage, runCommand = runReleaseCommand): Promise<void> {
  const script = item.manifest.scripts?.typecheck;
  if (script === undefined) return;
  const result = await runCommand("bun", ["run", "typecheck"], { cwd: item.directory });
  if (result.exitCode !== 0) throw new ReleaseError(`Typecheck failed for ${item.name}: ${result.stderr.trim() || result.stdout.trim()}`);
}

async function stagePackage(source: string, stage: string, files: readonly string[] | undefined): Promise<void> {
  await cp(join(source, "package.json"), join(stage, "package.json"));
  const entries = files ?? ["src", "README.md"];
  for (const entry of entries) {
    try {
      await cp(join(source, entry), join(stage, entry), { recursive: true });
    } catch (cause) {
      if (!(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
  }
  await mkdir(stage, { recursive: true });
}

async function pack(directory: string): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), "warbler-release-pack-"));
  const proc = Bun.spawn(["bun", "pm", "pack", "--destination", destination, "--quiet"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new ReleaseError(`bun pm pack failed: ${stderr.trim() || stdout.trim()}`);
  const tarball = stdout.trim().split(/\r?\n/u).find((line) => line.endsWith(".tgz"));
  if (tarball === undefined) throw new ReleaseError("bun pm pack did not report a tarball path.");
  return tarball;
}

async function packedPackageJson(tarball: string): Promise<PackageManifest> {
  const proc = Bun.spawn(["tar", "-xOzf", tarball, "package/package.json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new ReleaseError(`Unable to inspect packed manifest: ${stderr.trim()}`);
  const value: unknown = JSON.parse(stdout);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ReleaseError("Packed manifest is not an object.");
  return value as PackageManifest;
}

async function assertPackedLicense(tarball: string, expected: string): Promise<void> {
  const actual = await packedLicense(tarball);
  if (actual !== expected) throw new ReleaseError("Packed LICENSE does not match root LICENSE.");
}

async function packedLicense(tarball: string): Promise<string> {
  const proc = Bun.spawn(["tar", "-xOzf", tarball, "package/LICENSE"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new ReleaseError(`Unable to inspect packed LICENSE: ${stderr.trim()}`);
  return stdout;
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
