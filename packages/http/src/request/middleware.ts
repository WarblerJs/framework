import type { MaybePromise } from "@warblerjs/transport";
import type { AnyAppRequest, AppRequest } from "./app-request";
import type { RequestContextHandle } from "./request-context";

export type MiddlewareNext<TRequest extends AnyAppRequest = AppRequest, TResult = Response> =
  (req?: TRequest) => MaybePromise<TResult>;

/** Wraps the remaining pipeline. Call `next()` to continue, or return a result directly to short-circuit. */
export type Middleware<TRequest extends AnyAppRequest = AppRequest, TResult = Response> =
  (req: TRequest, context: RequestContextHandle, next: MiddlewareNext<TRequest, TResult>) => MaybePromise<TResult>;
