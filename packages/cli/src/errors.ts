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
