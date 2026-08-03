import type { CompiledHttpRoute } from "./compiled-http-route";

/** Compiler-resolved controller route collection. */
export interface CompiledHttpController {
  readonly name: string;
  readonly prefix: string;
  readonly routes: readonly CompiledHttpRoute[];
}
