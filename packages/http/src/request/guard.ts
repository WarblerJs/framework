import type { MaybePromise } from "@warblerjs/transport";
import type { AnyAppRequest, AppRequest } from "./app-request";
import type { RequestContextHandle } from "./request-context";

export type GuardResult = boolean | Response;

/** Runs before the controller handler. `false` denies; `Response` short-circuits normally. */
export type Guard<TRequest extends AnyAppRequest = AppRequest> =
  (req: TRequest, context: RequestContextHandle) => MaybePromise<GuardResult>;
