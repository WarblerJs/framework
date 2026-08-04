/** Compiler diagnostic severity. */
export type CompilerDiagnosticCategory = "error" | "warning";

/** A normalized compiler failure with stable source coordinates. */
export interface CompilerDiagnostic {
  readonly code: string;
  readonly category: CompilerDiagnosticCategory;
  readonly message: string;
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
  readonly relatedSymbols: readonly string[];
}

/** Stable Phase 1 diagnostic codes. */
export const DiagnosticCode = Object.freeze({
  DUPLICATE_GRAPH: "WARBLER1001",
  DUPLICATE_ROUTE: "WARBLER1002",
  DUPLICATE_SOCKET_EVENT: "WARBLER1003",
  DUPLICATE_PROVIDER: "WARBLER1004",
  INVALID_PROVIDER_SCOPE: "WARBLER1005",
  MISSING_GRAPH: "WARBLER1006",
  DEPENDENCY_CYCLE: "WARBLER1007",
  INVALID_DECORATOR: "WARBLER1008",
  PROVIDER_VISIBILITY: "WARBLER1009",
  DUPLICATE_CONTROLLER: "WARBLER1010",
  DUPLICATE_SOCKET_CONTROLLER: "WARBLER1011",
  PROJECT: "WARBLER1099",
} as const);
