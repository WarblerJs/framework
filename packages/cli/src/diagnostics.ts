/** Structured CLI diagnostic. */
export interface CLIDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly suggestion?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
/** Creates one immutable CLI diagnostic. */
export function cliDiagnostic(input: Omit<CLIDiagnostic, "metadata"> & { readonly metadata?: Readonly<Record<string, unknown>> }): CLIDiagnostic {
  return Object.freeze({ ...input, metadata: Object.freeze({ ...(input.metadata ?? {}) }) });
}
