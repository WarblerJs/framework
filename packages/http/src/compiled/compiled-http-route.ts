import type { HttpMethodValue } from "../route";
import type { BunRouteHandler } from "../native";

/** Resolved HTTP route consumed by Bun route-table generation. */
export interface CompiledHttpRoute {
  readonly method: HttpMethodValue;
  readonly path: string;
  readonly handler: BunRouteHandler;
  readonly flags?: number;
}
