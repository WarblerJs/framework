import type { Constructor } from "../types";

/** Options accepted by createApp(). */
export interface CreateAppOptions {
  readonly graphs: readonly Constructor[];
}

/** Immutable application definition consumed by compiler/runtime packages. */
export interface WarblerApplication {
  readonly graphs: readonly Constructor[];
}
