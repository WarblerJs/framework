import type { Guard } from "@warbler/core";
import type { HttpMethodValue } from "./http-method";

/** Options recorded by an HTTP route decorator. */
export interface HttpRouteOptions {
  readonly name?: string;
  readonly guards?: readonly Guard[];
  readonly middleware?: readonly ((input: unknown, next: (input?: unknown) => unknown) => unknown)[];
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
