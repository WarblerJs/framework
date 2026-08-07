import type { AnyRequestValidator, AppRequest } from "../request/app-request";
import type { Guard } from "../request/guard";
import type { Middleware } from "../request/middleware";
import type { HttpMethodValue } from "./http-method";

/** The `AppRequest` shape guards/middleware for a route see, derived from its validator. */
export type AppRequestFor<V extends AnyRequestValidator | undefined> =
  V extends AnyRequestValidator ? AppRequest<V> : AppRequest;

/** Options recorded by an HTTP route decorator. */
export interface HttpRouteOptions<V extends AnyRequestValidator | undefined = undefined> {
  readonly name?: string;
  readonly guards?: readonly Guard<AppRequestFor<V>>[];
  readonly middleware?: readonly Middleware<AppRequestFor<V>>[];
  readonly validator?: V;
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
