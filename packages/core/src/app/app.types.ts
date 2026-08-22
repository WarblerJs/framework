import type { Constructor } from "../types";
import type { Transport } from "../transport";

/** Options accepted by createApp(). */
export interface CreateAppOptions {
  readonly transports?: readonly Transport[];
  readonly graphs: readonly Constructor[] | string | readonly string[];
}

/** Immutable application definition consumed by compiler/runtime packages. */
export interface WarblerApplication {
  readonly transports: readonly Transport[];
  readonly graphs: readonly Constructor[] | string | readonly string[];
}
