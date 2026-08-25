import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class StarterVersionGenerationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StarterVersionGenerationError";
  }
}

export interface StarterPackageDescriptor<TKey extends string = string> {
  readonly key: TKey;
  readonly directory: TKey;
  readonly packageName: `@warblerjs/${TKey}`;
}

export interface GenerateStarterPackageVersionsOptions {
  readonly root?: string;
  readonly check?: boolean;
}

export interface StarterVersionGenerationResult {
  readonly root: string;
  readonly generatedPath: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly changed: boolean;
}

interface PackageManifest {
  readonly name?: unknown;
}

const STARTER_PACKAGES = Object.freeze([
  descriptor("config"),
  descriptor("crypto"),
  descriptor("database"),
  descriptor("email"),
  descriptor("framework"),
  descriptor("frontend"),
  descriptor("http"),
  descriptor("i18n"),
  descriptor("runtime"),
  descriptor("view"),
] as const);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?$/u;

export const STARTER_PACKAGE_DESCRIPTORS = STARTER_PACKAGES;

export async function generateStarterPackageVersions(
  options: GenerateStarterPackageVersionsOptions = {},
): Promise<StarterVersionGenerationResult> {
  const root = await resolveMonorepoRoot(options.root);
  const versions = await readStarterVersions(root);
  const generatedPath = resolveGeneratedPath(root);
  const expected = renderGeneratedFile(versions);
  const current = await readOptional(generatedPath);
  if (options.check === true) {
    if (current !== expected) {
      throw new StarterVersionGenerationError(
        "Starter package version manifest is stale. Run: bun run --cwd packages/cli generate:starter-versions",
      );
    }
    return Object.freeze({ root, generatedPath, versions, changed: false });
  }
  if (current === expected) return Object.freeze({ root, generatedPath, versions, changed: false });
  await atomicWrite(generatedPath, expected);
  return Object.freeze({ root, generatedPath, versions, changed: true });
}

export async function readStarterVersions(root: string): Promise<Readonly<Record<string, string>>> {
  const versions = await readCompatibilityCatalog(resolve(root, "packages/cli/starter-compatibility.json"));
  await assertLocalStarterPackages(root);
  return versions;
}

export async function assertLocalStarterPackages(root: string): Promise<void> {
  for (const item of STARTER_PACKAGES) {
    const manifest = await readPackageManifest(resolve(root, "packages", item.directory, "package.json"));
    if (manifest.name !== item.packageName) {
      throw new StarterVersionGenerationError(
        `Package manifest name mismatch for ${item.key}: expected ${item.packageName}, got ${String(manifest.name)}`,
      );
    }
  }
}

async function readCompatibilityCatalog(path: string): Promise<Readonly<Record<string, string>>> {
  const catalog = await readJsonObject(path, "starter compatibility catalog");
  const entries: Array<readonly [string, string]> = [];
  for (const item of STARTER_PACKAGES) {
    const version = catalog[item.key];
    if (typeof version !== "string" || version.length === 0) {
      throw new StarterVersionGenerationError(`Starter compatibility version is missing for ${item.key}`);
    }
    assertSemver(version, item.packageName);
    entries.push(Object.freeze([item.key, version]));
  }
  for (const key of Object.keys(catalog)) {
    if (!STARTER_PACKAGES.some((item) => item.key === key)) {
      throw new StarterVersionGenerationError(`Starter compatibility catalog contains unsupported package: ${key}`);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function renderGeneratedFile(versions: Readonly<Record<string, string>>): string {
  const lines = [
    "/** Generated file. Do not edit manually. */",
    "export const STARTER_PACKAGE_VERSIONS = Object.freeze({",
  ];
  for (const item of STARTER_PACKAGES) {
    const version = versions[item.key];
    if (version === undefined) {
      throw new StarterVersionGenerationError(`Missing generated starter version for ${item.key}`);
    }
    assertSemver(version, item.packageName);
    lines.push(`  ${item.key}: ${JSON.stringify(version)},`);
  }
  lines.push("} as const);", "", "export type StarterPackageName = keyof typeof STARTER_PACKAGE_VERSIONS;", "");
  return lines.join("\n");
}

async function resolveMonorepoRoot(explicit: string | undefined): Promise<string> {
  const root = explicit === undefined
    ? resolve(import.meta.dir, "..", "..", "..")
    : resolve(explicit);
  const manifest = await readJsonObject(resolve(root, "package.json"), "monorepo package manifest");
  if (manifest.name !== "warbler") {
    throw new StarterVersionGenerationError(`Unable to resolve Warbler monorepo root: ${root}`);
  }
  return root;
}

async function readPackageManifest(path: string): Promise<PackageManifest> {
  return readJsonObject(path, "package manifest");
}

async function readJsonObject(path: string, label: string): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    throw new StarterVersionGenerationError(`Unable to read ${label}: ${path}\n${errorMessage(cause)}`);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) throw new StarterVersionGenerationError(`${label} root is not an object: ${path}`);
    return value;
  } catch (cause) {
    if (cause instanceof StarterVersionGenerationError) throw cause;
    throw new StarterVersionGenerationError(`${label} is malformed JSON: ${path}\n${errorMessage(cause)}`);
  }
}

function descriptor<const TKey extends string>(key: TKey): StarterPackageDescriptor<TKey> {
  return Object.freeze({
    key,
    directory: key,
    packageName: `@warblerjs/${key}`,
  });
}

function resolveGeneratedPath(root: string): string {
  return resolve(root, "packages/cli/src/new/starter-package-versions.generated.ts");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new StarterVersionGenerationError(`Unable to write generated starter versions: ${path}\n${errorMessage(cause)}`);
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (isMissing(cause)) return undefined;
    throw new StarterVersionGenerationError(`Unable to read generated starter versions: ${path}\n${errorMessage(cause)}`);
  }
}

function assertSemver(version: string, label: string): void {
  if (!SEMVER.test(version)) {
    throw new StarterVersionGenerationError(`Unsupported SemVer version for ${label}: ${version}`);
  }
}

function parseArgs(argv: readonly string[]): GenerateStarterPackageVersionsOptions {
  let check = false;
  let root: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--check") {
      check = true;
    } else if (arg === "--root") {
      const value = argv[index + 1];
      if (value === undefined) throw new StarterVersionGenerationError("--root requires a path");
      root = value;
      index++;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
      if (root.length === 0) throw new StarterVersionGenerationError("--root requires a path");
    } else {
      throw new StarterVersionGenerationError(`Unknown argument: ${arg}`);
    }
  }
  return Object.freeze({
    ...(root === undefined ? {} : { root }),
    ...(check ? { check } : {}),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

if (import.meta.main) {
  try {
    const result = await generateStarterPackageVersions(parseArgs(Bun.argv.slice(2)));
    const action = result.changed ? "Generated" : "Starter package versions already current";
    console.log(`${action}: ${result.generatedPath}`);
  } catch (cause) {
    console.error(errorMessage(cause));
    process.exit(1);
  }
}
