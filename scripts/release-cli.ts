#!/usr/bin/env bun
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateStarterConfigs } from "../packages/cli/scripts/generate-starter-configs";
import { generateStarterPackageVersions } from "../packages/cli/scripts/generate-starter-package-versions";
import { RegistryNpmClient } from "./release/npm-client";
import { npmTag } from "./release/semver";
import { NPM_REGISTRY, type NpmClient } from "./release/types";

export class CliReleaseError extends Error {
  public readonly exitCode: number;

  public constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliReleaseError";
    this.exitCode = exitCode;
  }
}

export type CliReleaseMode = "check" | "publish";

export interface CliReleaseOptions {
  readonly root?: string;
  readonly registry?: string;
  readonly mode: CliReleaseMode;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliReleaseDependencies {
  readonly npm?: NpmClient;
  readonly runCommand?: CommandRunner;
  readonly publishTarball?: PublishTarball;
  readonly generateStarterConfigs?: GenerationStep;
  readonly generateStarterPackageVersions?: GenerationStep;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{ readonly cwd: string; readonly inheritOutput?: boolean }>,
) => Promise<CommandResult>;

export type PublishTarball = (
  npm: NpmClient,
  tarball: string,
  tag: string,
) => Promise<void>;

export type GenerationStep = (
  options: Readonly<{ readonly root: string; readonly check?: boolean }>,
) => Promise<Readonly<{ readonly changed: boolean }>>;

interface CliManifest {
  readonly name: string;
  readonly version: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_PACKED_FILES = Object.freeze([
  "package/src/new/starter-configs.generated.ts",
  "package/src/new/starter-package-versions.generated.ts",
] as const);

export async function runCliRelease(
  options: CliReleaseOptions,
  dependencies: CliReleaseDependencies = {},
): Promise<void> {
  try {
    await runCliReleaseGates(options, dependencies);
  } catch (cause) {
    if (cause instanceof CliReleaseError) {
      throw new CliReleaseError(redactSensitiveText(cause.message), cause.exitCode);
    }
    throw new CliReleaseError(redactSensitiveText(errorMessage(cause)));
  }
}

async function runCliReleaseGates(
  options: CliReleaseOptions,
  dependencies: CliReleaseDependencies,
): Promise<void> {
  const releaseRoot = resolve(options.root ?? root);
  const registry = options.registry ?? NPM_REGISTRY;
  const npm = dependencies.npm ?? new RegistryNpmClient(registry);
  const runCommand = dependencies.runCommand ?? runProcess;
  const publishTarball = dependencies.publishTarball ?? defaultPublishTarball;
  const generateConfigs = dependencies.generateStarterConfigs ?? generateStarterConfigs;
  const generateVersions = dependencies.generateStarterPackageVersions ?? generateStarterPackageVersions;

  await assertCleanGit(releaseRoot, runCommand);
  const configGeneration = await generateConfigs({ root: releaseRoot });
  if (configGeneration.changed) throw generatedArtifactsChanged();
  const versionGeneration = await generateVersions({ root: releaseRoot });
  if (versionGeneration.changed) throw generatedArtifactsChanged();
  if ((await gitStatus(releaseRoot, runCommand)).length > 0) {
    throw generatedArtifactsChanged();
  }

  await generateConfigs({ root: releaseRoot, check: true });
  await generateVersions({ root: releaseRoot, check: true });
  await runChecked(runCommand, "bun", ["run", "typecheck"], join(releaseRoot, "packages/cli"), "CLI typecheck");
  await runChecked(runCommand, "bun", ["test", "packages/cli/tests"], releaseRoot, "CLI tests");

  const packedFiles = await npmPackDryRun(releaseRoot, runCommand);
  for (const file of GENERATED_PACKED_FILES) {
    if (!packedFiles.has(file)) throw new CliReleaseError(`npm pack --dry-run did not include ${file}`);
  }

  const manifest = await readCliManifest(releaseRoot);
  const metadata = await npm.metadata(manifest.name, manifest.version);
  if (metadata.exists) throw new CliReleaseError(`${manifest.name}@${manifest.version} is already published to npm.`);

  if (options.mode === "publish") {
    if (!await npm.whoami()) throw new CliReleaseError("npm authentication is required before publishing @warblerjs/cli.");
    await packAndPublishCli(releaseRoot, runCommand, npm, publishTarball, npmTag(manifest.version));
  }
}

export function parseCliReleaseArgs(args: readonly string[]): CliReleaseOptions {
  let mode: CliReleaseMode | undefined;
  let registry: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--check" || arg === "--dry-run") {
      if (mode !== undefined) throw new CliReleaseError("Choose only one of --check, --dry-run, or --publish.");
      mode = "check";
      continue;
    }
    if (arg === "--publish") {
      if (mode !== undefined) throw new CliReleaseError("Choose only one of --check, --dry-run, or --publish.");
      mode = "publish";
      continue;
    }
    if (arg === "--registry") {
      registry = value(args, ++index, arg);
      continue;
    }
    throw new CliReleaseError(`Unknown CLI release flag: ${arg}`);
  }
  if (mode === undefined) {
    throw new CliReleaseError("CLI release requires explicit intent. Pass --check, --dry-run, or --publish.");
  }
  return Object.freeze({
    mode,
    ...(registry === undefined ? {} : { registry }),
  });
}

async function assertCleanGit(root: string, runCommand: CommandRunner): Promise<void> {
  if ((await gitStatus(root, runCommand)).length > 0) {
    throw new CliReleaseError("CLI release requires a clean git working tree before starting.");
  }
}

async function gitStatus(root: string, runCommand: CommandRunner): Promise<string> {
  const result = await runCommand("git", ["status", "--short"], { cwd: root });
  if (result.exitCode !== 0) {
    throw new CliReleaseError(`Unable to inspect git status: ${result.stderr.trim()}`, result.exitCode);
  }
  return result.stdout.trim();
}

async function npmPackDryRun(root: string, runCommand: CommandRunner): Promise<ReadonlySet<string>> {
  const result = await runCommand("npm", ["pack", "--dry-run", "--json"], { cwd: join(root, "packages/cli") });
  if (result.exitCode !== 0) throw new CliReleaseError(`npm pack --dry-run failed: ${result.stderr.trim() || result.stdout.trim()}`, result.exitCode);
  const files = parseNpmPackFiles(result.stdout);
  return new Set(files.map((path) => `package/${path}`));
}

async function packAndPublishCli(
  root: string,
  runCommand: CommandRunner,
  npm: NpmClient,
  publishTarball: PublishTarball,
  tag: string,
): Promise<void> {
  const destination = await mkdtemp(join(tmpdir(), "warbler-cli-release-pack-"));
  try {
    const result = await runCommand("npm", ["pack", "--json", "--pack-destination", destination], { cwd: join(root, "packages/cli") });
    if (result.exitCode !== 0) throw new CliReleaseError(`npm pack failed: ${result.stderr.trim() || result.stdout.trim()}`, result.exitCode);
    const tarball = parseNpmPackTarball(result.stdout);
    await publishTarball(npm, isAbsolute(tarball) ? tarball : resolve(destination, tarball), tag);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

function parseNpmPackFiles(stdout: string): readonly string[] {
  const first = firstPackEntry(stdout);
  const files = first.files;
  if (!Array.isArray(files)) throw new CliReleaseError("npm pack --dry-run JSON did not contain a files array.");
  const paths: string[] = [];
  for (const file of files) {
    if (!isRecord(file) || typeof file.path !== "string") {
      throw new CliReleaseError("npm pack --dry-run JSON contained an invalid file entry.");
    }
    paths.push(file.path);
  }
  return Object.freeze(paths);
}

function parseNpmPackTarball(stdout: string): string {
  const first = firstPackEntry(stdout);
  if (typeof first.filename !== "string" || !first.filename.endsWith(".tgz")) {
    throw new CliReleaseError("npm pack JSON did not contain a tarball filename.");
  }
  return first.filename;
}

function firstPackEntry(stdout: string): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (cause) {
    throw new CliReleaseError(`npm pack did not produce JSON: ${errorMessage(cause)}`);
  }
  if (!Array.isArray(value) || value.length === 0 || !isRecord(value[0])) {
    throw new CliReleaseError("npm pack JSON root was not a non-empty array.");
  }
  return value[0];
}

async function readCliManifest(root: string): Promise<CliManifest> {
  const path = join(root, "packages/cli/package.json");
  const text = await readFile(path, "utf8");
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.version !== "string") {
    throw new CliReleaseError(`CLI package manifest requires name and version: ${path}`);
  }
  return Object.freeze({ name: value.name, version: value.version });
}

async function runChecked(
  runCommand: CommandRunner,
  command: string,
  args: readonly string[],
  cwd: string,
  label: string,
): Promise<void> {
  const result = await runCommand(command, args, { cwd, inheritOutput: true });
  if (result.exitCode !== 0) throw new CliReleaseError(`${label} failed.`, result.exitCode);
}

async function runProcess(
  command: string,
  args: readonly string[],
  options: Readonly<{ readonly cwd: string; readonly inheritOutput?: boolean }>,
): Promise<CommandResult> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stdout: options.inheritOutput === true ? "inherit" : "pipe",
    stderr: options.inheritOutput === true ? "inherit" : "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    options.inheritOutput === true ? Promise.resolve("") : new Response(child.stdout).text(),
    options.inheritOutput === true ? Promise.resolve("") : new Response(child.stderr).text(),
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

async function defaultPublishTarball(npm: NpmClient, tarball: string, tag: string): Promise<void> {
  await npm.publish(tarball, tag);
}

function generatedArtifactsChanged(): CliReleaseError {
  return new CliReleaseError(
    "CLI release aborted: generated starter artifacts changed.\nReview and commit the generated files before publishing.",
  );
}

function value(args: readonly string[], index: number, flag: string): string {
  const item = args[index];
  if (item === undefined || item.startsWith("--")) throw new CliReleaseError(`${flag} requires a value.`);
  return item;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

if (import.meta.main) {
  try {
    const options = parseCliReleaseArgs(Bun.argv.slice(2));
    await runCliRelease(options);
    console.log(options.mode === "publish" ? "CLI release complete." : "CLI release dry run complete.");
  } catch (cause) {
    const message = redactSensitiveText(cause instanceof Error ? cause.message : "Unknown CLI release failure");
    console.error(message);
    process.exit(cause instanceof CliReleaseError ? cause.exitCode : 1);
  }
}

function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (!isSensitiveEnvName(key) || value === undefined || value.length < 3) continue;
    redacted = redacted.split(value).join("[redacted]");
  }
  return redacted
    .replace(/npm_[A-Za-z0-9_-]{8,}/gu, "[redacted]")
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/gu, "//[redacted]@");
}

function isSensitiveEnvName(key: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|AUTH|API_KEY|CRYPTO_KEY|HMAC_KEY)/u.test(key);
}
