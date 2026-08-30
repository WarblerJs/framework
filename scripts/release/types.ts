export const WARBLER_SCOPE = "@warblerjs/" as const;
export const NPM_REGISTRY = "https://registry.npmjs.org/" as const;
export const staleWarblerScopes = Object.freeze(["@warbler/", "@wawarblerjsbler/", "@warblerjsjs/"] as const);

export type DependencyField = "dependencies" | "optionalDependencies" | "peerDependencies" | "devDependencies";
export const dependencyFields = Object.freeze(["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"] as const);
export type ReleaseOrderDependencyField = "dependencies" | "optionalDependencies" | "peerDependencies";
export const releaseOrderDependencyFields = Object.freeze(["dependencies", "optionalDependencies", "peerDependencies"] as const);
export type ReleaseProgressPhase =
  | "Testing workspace"
  | "Typechecking packages"
  | "Packing packages"
  | "Validating packed manifests"
  | "Smoke-testing packed imports";

export interface ReleaseCommandOptions {
  readonly cwd: string;
}

export interface ReleaseCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ReleaseCommandRunner = (
  command: string,
  args: readonly string[],
  options: ReleaseCommandOptions,
) => Promise<ReleaseCommandResult>;

export interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly bin?: unknown;
  readonly exports?: unknown;
  readonly files?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface WorkspacePackage {
  readonly name: string;
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
  readonly currentVersion: string;
  readonly private: boolean;
}

export type PublishStatus = "publish" | "skip";

export type ReleaseReason =
  | "lockstep-release";

export type SkipReason = "already-published";

export interface ExplicitReleaseRequest {
  readonly packageName: string;
  readonly bump: "patch";
}

export interface ReleasePlannerOptions {
  readonly targetVersion: string;
}

export interface ReleasePackage {
  readonly name: string;
  readonly directory: string;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly npmTag: string;
  readonly internalDependencies: readonly string[];
  readonly shouldPublish: boolean;
  readonly reason: ReleaseReason | SkipReason;
}

export interface ReleasePlan {
  readonly packages: readonly ReleasePackage[];
  readonly staleReferences: readonly StaleReference[];
}

export interface ReleaseResult {
  readonly planned: readonly string[];
  readonly published: readonly string[];
  readonly skipped: readonly string[];
  readonly failed?: string;
}

export interface StaleReference {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

export interface PublishedPackageMetadata {
  readonly exists: boolean;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface NpmClient {
  readonly registry: string;
  metadata(name: string, version: string): Promise<PublishedPackageMetadata>;
  versions(name: string): Promise<readonly string[]>;
  whoami(): Promise<boolean>;
  publish(tarball: string, tag: string): Promise<void>;
}

export interface ReleaseOptions {
  readonly root: string;
  readonly dryRun?: boolean;
  readonly noTests?: boolean;
  readonly json?: boolean;
  readonly registry?: string;
  readonly allowDirty?: boolean;
  readonly targetVersion: string;
  readonly npm?: NpmClient;
  readonly runCommand?: ReleaseCommandRunner;
  readonly progress?: (phase: ReleaseProgressPhase) => void | Promise<void>;
  readonly onPlan?: (plan: ReleasePlan) => void | Promise<void>;
}

export interface PackedPackage {
  readonly packageName: string;
  readonly version: string;
  readonly tarball: string;
  readonly manifest: PackageManifest;
}

export class ReleaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}
