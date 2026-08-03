import type { TransportContext } from "./transport-context";

/** Immutable values supplied to an adapter when its transport starts. */
export interface TransportStartContext<TConfig, TShared = undefined> {
  /** Validated transport-specific configuration. */
  readonly config: Readonly<TConfig>;
  /** Shared transport context. */
  readonly transport: TransportContext<TShared>;
}
