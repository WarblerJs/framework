import { normalizeError, WarblerError, type NormalizedWarblerError } from "@warblerjs/core";
import { HttpError } from "./http-error";

/**
 * Normalizes any thrown value for the HTTP error boundary. The only HTTP-specific
 * knowledge here is recognizing `HttpError` (and its subclasses, e.g. `CsrfError`) and
 * translating it into a `WarblerError` first — everything else, including `WarblerError`
 * itself, delegates straight to `@warblerjs/core`'s transport-agnostic `normalizeError`.
 */
export function toNormalizedHttpError(error: unknown): NormalizedWarblerError {
  if (!(error instanceof WarblerError) && error instanceof HttpError) {
    return normalizeError(new WarblerError(error.code, error.status, error.message, true, false, { cause: error }));
  }
  return normalizeError(error);
}
