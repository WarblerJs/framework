import type { Provider, ProviderToken } from "../di";
import type { TransportType } from "../transport";
import type { Constructor } from "../types";

/** Options accepted by the Graph decorator. */
export interface GraphOptions {
  readonly prefix?: string;
  readonly transport?: TransportType;
  readonly controllers?: readonly Constructor[];
  readonly providers?: readonly Provider[]; 
}

/** Normalized graph metadata used by the compiler and runtime. */
export interface GraphMetadata {
  readonly prefix: string; 
  readonly transport: TransportType;
  readonly controllers: readonly Constructor[];
  readonly providers: readonly Provider[]; 
}
