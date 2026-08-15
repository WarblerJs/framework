import type { ProviderDefinition } from "@warbler/core";

/** Immutable HTTP controller metadata consumed by the compiler. */
export interface ControllerMetadata {
  readonly prefix: string;
  readonly providers: readonly ProviderDefinition[];
}

/** Options accepted by the HTTP Controller decorator. */
export interface ControllerOptions {
  readonly prefix?: string;
  readonly providers?: readonly ProviderDefinition[];
}
