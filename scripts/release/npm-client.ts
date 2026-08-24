import { NPM_REGISTRY, ReleaseError, type NpmClient, type PublishedPackageMetadata } from "./types";

export class RegistryNpmClient implements NpmClient {
  public readonly registry: string;

  public constructor(registry: string = NPM_REGISTRY) {
    this.registry = registry;
  }

  public async metadata(name: string, version: string): Promise<PublishedPackageMetadata> {
    const url = `${this.registryRoot()}/${registryPackagePath(name)}/${encodeURIComponent(version)}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.status === 404) return Object.freeze({ exists: false });
    if (!response.ok) throw new ReleaseError(`npm metadata lookup failed for ${name}@${version}: HTTP ${response.status}`);
    const value = await response.json() as Readonly<Record<string, unknown>>;
    return Object.freeze({
      exists: true,
      version: typeof value.version === "string" ? value.version : version,
      dependencies: stringRecord(value.dependencies),
      optionalDependencies: stringRecord(value.optionalDependencies),
      peerDependencies: stringRecord(value.peerDependencies),
    });
  }

  public async versions(name: string): Promise<readonly string[]> {
    const url = `${this.registryRoot()}/${registryPackagePath(name)}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.status === 404) return Object.freeze([]);
    if (!response.ok) throw new ReleaseError(`npm versions lookup failed for ${name}: HTTP ${response.status}`);
    const value = await response.json() as Readonly<Record<string, unknown>>;
    const versions = value.versions;
    return versions !== undefined && typeof versions === "object" && versions !== null && !Array.isArray(versions)
      ? Object.freeze(Object.keys(versions).sort())
      : Object.freeze([]);
  }

  public async whoami(): Promise<boolean> {
    const proc = Bun.spawn(["npm", "whoami", "--registry", this.registry], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return code === 0;
  }

  public async publish(tarball: string, tag: string): Promise<void> {
    const proc = Bun.spawn(["npm", "publish", tarball, "--access", "public", "--tag", tag, "--registry", this.registry], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new ReleaseError(`npm publish failed for ${tarball}`);
  }

  private registryRoot(): string {
    return this.registry.replace(/\/$/u, "");
  }
}

function registryPackagePath(name: string): string {
  return encodeURIComponent(name).replace("%40", "@");
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === "string") output[key] = item;
  return Object.freeze(output);
}
