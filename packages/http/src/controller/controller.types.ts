import type { ProviderDefinition } from "@warblerjs/core";
import type { Middleware } from "../request/middleware";

/** Immutable HTTP controller metadata consumed by the compiler. */
export interface ControllerMetadata {
  readonly prefix: string;
  readonly providers: readonly ProviderDefinition[];
  readonly middleware: readonly Middleware[];
}

/** Options accepted by the HTTP Controller decorator. */
export interface ControllerOptions {
  readonly prefix?: string;
  readonly providers?: readonly ProviderDefinition[];
  readonly middleware?: readonly Middleware[];
}
