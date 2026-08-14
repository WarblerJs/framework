import { WarblerError } from "./warbler-error";

/**
 * Compatibility alias for the one normalized model every transport renders and logs from.
 */
export type NormalizedWarblerError = WarblerError;

export interface WarblerErrorCauseRecord {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

const INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR";
export const INTERNAL_SERVER_ERROR_MESSAGE = "Internal Server Error";

/**
 * Normalizes any thrown value exactly once into the transport-agnostic `WarblerError` model.
 * Existing `WarblerError` instances pass through unchanged so logger and presenter consumers
 * always see the same object at one boundary.
 */
export function normalizeError(error: unknown): WarblerError {
  if (error instanceof WarblerError) return error;

  return new WarblerError(INTERNAL_SERVER_ERROR, 500, INTERNAL_SERVER_ERROR_MESSAGE, false, false, {
    cause: error,
    developerMessage: developerMessage(error),
  });
}

/** Returns the only message safe for a transport response in the current environment. */
export function safeErrorMessage(error: WarblerError, development = false): string {
  return development || error.expose ? error.message : INTERNAL_SERVER_ERROR_MESSAGE;
}

/** Lazily walks the cause chain for error-path diagnostics and file logging. */
export function errorCauseChain(error: WarblerError, maxDepth = 8): readonly WarblerErrorCauseRecord[] {
  const chain: WarblerErrorCauseRecord[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current instanceof Error && depth < maxDepth) {
    const record: { name: string; message: string; stack?: string } = {
      name: current.name,
      message: current.message,
    };
    if (current.stack !== undefined) record.stack = current.stack;
    chain.push(Object.freeze(record));
    current = current.cause;
    depth++;
  }
  return Object.freeze(chain);
}

function developerMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
}
