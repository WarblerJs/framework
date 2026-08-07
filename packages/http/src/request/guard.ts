import type { MaybePromise } from "@warbler/transport";
import type { AnyAppRequest, AppRequest } from "./app-request";
import type { RequestContextHandle } from "./request-context";

/** Runs before the controller handler. Returning `false` short-circuits the request as forbidden. */
export type Guard<TRequest extends AnyAppRequest = AppRequest> =
  (req: TRequest, context: RequestContextHandle) => MaybePromise<boolean>;
