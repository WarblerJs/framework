import type { Constructor } from "@warbler/core";
import type { HttpMethodValue } from "./http-method";

/** Options recorded by an HTTP route decorator. */
export interface HttpRouteOptions {
  readonly name?: string;
  readonly guards?: readonly Constructor[];
  readonly middleware?: readonly Constructor[];
  readonly validator?: unknown;
  readonly policy?: unknown;
  readonly timeoutMs?: number;
  readonly tags?: readonly string[];
  readonly csrf?: boolean;
  readonly stream?: "sse" | "html";
}

/** Immutable route metadata consumed by the compiler. */
export interface HttpRouteMetadata extends HttpRouteOptions {
  readonly method: HttpMethodValue;
  readonly path: string;
}
