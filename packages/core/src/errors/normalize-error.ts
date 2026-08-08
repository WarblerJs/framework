import { WarblerError } from "./warbler-error";

/**
 * The one shared shape every transport-specific error boundary renders from. `message` is
 * already the safe-to-expose variant (the real message when `expose` is `true`, a generic
 * fallback otherwise) — renderers never need to re-check `expose` against `message` itself.
 * `cause` retains the original thrown value for server-side logging only; it must never be
 * serialized into a client-visible response.
 */
export interface NormalizedWarblerError {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly expose: boolean;
  readonly fatal: boolean;
  readonly cause: unknown;
}

const INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR";
const INTERNAL_SERVER_ERROR_MESSAGE = "Internal Server Error";

/**
 * Normalizes any thrown value into one safe, renderable shape. Recognizes `WarblerError`;
 * everything else (native `Error`, a rejected non-`Error` value, framework-internal errors
 * this package doesn't know about) becomes a generic, non-exposed internal error — callers
 * that recognize additional domain-specific error types (e.g. `@warbler/http`'s `HttpError`)
 * should translate those into a `WarblerError` before calling this, rather than this function
 * growing awareness of every package's error hierarchy.
 */
export function normalizeError(error: unknown): NormalizedWarblerError {
  if (error instanceof WarblerError) {
    return Object.freeze({
      code: error.code,
      status: error.status,
      message: error.expose ? error.message : INTERNAL_SERVER_ERROR_MESSAGE,
      expose: error.expose,
      fatal: error.fatal,
      cause: error,
    });
  }

  return Object.freeze({
    code: INTERNAL_SERVER_ERROR,
    status: 500,
    message: INTERNAL_SERVER_ERROR_MESSAGE,
    expose: false,
    fatal: false,
    cause: error,
  });
}
