/** Stable Runtime diagnostic record. */
export interface RuntimeDiagnostic {
  readonly code: string;
  readonly category: "error" | "warning";
  readonly message: string;
  readonly phase: "loader" | "providers" | "config" | "transport" | "hook" | "shutdown";
  readonly transport?: string;
}

/** Creates an immutable Runtime diagnostic. */
export function createRuntimeDiagnostic(
  code: string,
  message: string,
  phase: RuntimeDiagnostic["phase"],
  transport?: string,
): RuntimeDiagnostic {
  return Object.freeze({ code, category: "error", message, phase, ...(transport === undefined ? {} : { transport }) });
}
