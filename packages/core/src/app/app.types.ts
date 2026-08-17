import type { Constructor } from "../types";

/** Options accepted by createApp(). */
export interface CreateAppOptions {
  readonly graphs: readonly Constructor[];
  readonly middleware?: readonly unknown[];
}

/** Immutable application definition consumed by compiler/runtime packages. */
export interface WarblerApplication {
  readonly graphs: readonly Constructor[];
  readonly middleware: readonly unknown[];
}
