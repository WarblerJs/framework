import type { TransportKindValue } from "../types";
import type { TransportAdapter } from "./transport-adapter";
import type { TransportContext } from "./transport-context";

/** Creates isolated adapter instances for a specific transport kind. */
export interface TransportFactory<TConfig, TNative, TShared = undefined> {
  /** Identifies the transport produced by this factory. */
  readonly kind: TransportKindValue;
  /** Creates an adapter bound to an immutable shared context. */
  create(context: TransportContext<TShared>): TransportAdapter<TConfig, TNative, TShared>;
}
