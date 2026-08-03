import type { TransportContext } from "./transport-context";

/** Immutable values supplied to an adapter when its transport stops. */
export interface TransportStopContext<TNative, TShared = undefined> {
  /** Native implementation handle returned during startup. */
  readonly native: TNative;
  /** Shared transport context. */
  readonly transport: TransportContext<TShared>;
}
