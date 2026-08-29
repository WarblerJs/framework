import packageMetadata from "../package.json" with { type: "json" };

/** Version of the installed Warbler CLI package. */
export const CLI_VERSION = packageMetadata.version;
export const UNKNOWN_VERSION = "unknown";

const FRAMEWORK_PACKAGE = "@warblerjs/framework";

/** Resolves the installed Warbler framework package version for one project. */
export async function resolveProjectFrameworkVersion(projectRoot: string): Promise<string> {
  try {
    const installedVersion = await readInstalledFrameworkVersion(projectRoot);
    if (installedVersion !== undefined) return installedVersion;
    const entry = Bun.resolveSync(FRAMEWORK_PACKAGE, projectRoot);
    const version = await readFrameworkVersionFromEntry(entry);
    return version ?? UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

async function readInstalledFrameworkVersion(projectRoot: string): Promise<string | undefined> {
  const manifestPath = `${projectRoot.replace(/\/+$/u, "")}/node_modules/@warblerjs/framework/package.json`;
  const file = Bun.file(manifestPath);
  if (!await file.exists()) return undefined;
  const manifest = await readManifest(manifestPath);
  if (manifest?.name === FRAMEWORK_PACKAGE && typeof manifest.version === "string" && manifest.version.length > 0) {
    return manifest.version;
  }
  return UNKNOWN_VERSION;
}

async function readFrameworkVersionFromEntry(entry: string): Promise<string | undefined> {
  let directory = directoryOf(entry);
  while (directory !== undefined) {
    const manifest = await readManifest(`${directory}/package.json`);
    if (manifest !== undefined) {
      if (manifest.name === FRAMEWORK_PACKAGE && typeof manifest.version === "string" && manifest.version.length > 0) {
        return manifest.version;
      }
      return undefined;
    }
    directory = parentDirectory(directory);
  }
  return undefined;
}

async function readManifest(path: string): Promise<Readonly<Record<string, unknown>> | undefined> {
  try {
    const value: unknown = await Bun.file(path).json();
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function directoryOf(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? undefined : normalized.slice(0, index);
}

function parentDirectory(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  if (index <= 0) return undefined;
  return path.slice(0, index);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
