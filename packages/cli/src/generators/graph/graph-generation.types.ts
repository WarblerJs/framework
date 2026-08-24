/** Architecture presets supported by the Graph generator. */
export type Architecture = keyof typeof import("./architecture-registry").architecturePresets;

/** Transport presets supported by the Graph generator. */
export type GraphTransport = keyof typeof import("./transport-registry").transportPresets;

/** Input accepted by the reusable Graph generator engine. */
export interface GraphGenerationInput {
  readonly projectRoot: string;
  readonly name: string;
  readonly architecture?: Architecture;
  readonly transports?: readonly GraphTransport[];
  readonly dryRun?: boolean;
}

/** One planned file emitted by the Graph generator. */
export interface GraphGeneratedFile {
  readonly path: string;
  readonly content: string;
}

/** Deterministic Graph generation plan before filesystem writes. */
export interface GraphGenerationPlan {
  readonly graphName: string;
  readonly directoryName: string;
  readonly identifierBase: string;
  readonly routePrefix: string;
  readonly routeNamePrefix: string;
  readonly architecture: Architecture;
  readonly transports: readonly GraphTransport[];
  readonly rootDirectory: string;
  readonly directories: readonly string[];
  readonly files: readonly GraphGeneratedFile[];
}

/** Structured result returned after validation and optional writes. */
export interface GraphGenerationResult {
  readonly graphName: string;
  readonly architecture: Architecture;
  readonly transports: readonly GraphTransport[];
  readonly files: readonly string[];
  readonly directories: readonly string[];
  readonly dryRun: boolean;
}
