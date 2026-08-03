import type { MaybePromise, TransportKindValue } from "../types";
import type { TransportStartContext } from "./transport-start-context";
import type { TransportStopContext } from "./transport-stop-context";

/** Contract implemented by every concrete Warbler transport. */
export interface TransportAdapter<TConfig, TNative, TShared = undefined> {
  /** Identifies the transport implemented by this adapter. */
  readonly kind: TransportKindValue;
  /** Starts the native transport and returns its implementation handle. */
  start(context: TransportStartContext<TConfig, TShared>): MaybePromise<TNative>;
  /** Stops the native transport represented by the supplied handle. */
  stop(context: TransportStopContext<TNative, TShared>): MaybePromise<void>;
}
