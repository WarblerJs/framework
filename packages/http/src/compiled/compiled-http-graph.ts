import type { CompiledHttpController } from "./compiled-http-controller";

/** Compiler-resolved HTTP graph collection. */
export interface CompiledHttpGraph {
  readonly prefix: string;
  readonly controllers: readonly CompiledHttpController[];
}
