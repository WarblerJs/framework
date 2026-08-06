import type { ExitCodeValue } from "./types";
/** Typed CLI failure crossing the top-level command boundary. */
export class CLIError extends Error {
  public readonly code: string;
  public readonly exitCode: ExitCodeValue;
  public readonly suggestion?: string;
  /** Creates a typed CLI failure. */
  public constructor(code: string, message: string, exitCode: ExitCodeValue, suggestion?: string, options?: ErrorOptions) {
    super(message, options); this.name = "CLIError"; this.code = code; this.exitCode = exitCode;
    if (suggestion !== undefined) this.suggestion = suggestion;
  }
}

/** Flattens an Error's `.cause` chain into one readable "outer: cause: root cause" message, so wrapped failures (e.g. a Runtime transport error caused by an underlying config validation error) surface their real root cause instead of just the outermost wrapper's message. Non-Error values fall back to `fallback`. */
export function describeErrorChain(error: unknown, fallback = "Unknown failure"): string {
  if (!(error instanceof Error)) return fallback;
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(": ");
}
