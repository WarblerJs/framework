import type { CompilerDiagnostic } from "./diagnostic";

/** Stable executable-binding diagnostic codes. */
export const BindingDiagnosticCode = Object.freeze({
  SYMBOL_NOT_FOUND: "WARBLER_BINDING_SYMBOL_NOT_FOUND",
  NOT_EXPORTED: "WARBLER_BINDING_NOT_EXPORTED",
  IMPORT_UNRESOLVED: "WARBLER_BINDING_IMPORT_UNRESOLVED",
  HANDLER_NOT_FOUND: "WARBLER_BINDING_HANDLER_NOT_FOUND",
  INVALID_HANDLER: "WARBLER_BINDING_INVALID_HANDLER",
  PROVIDER_FACTORY_FAILED: "WARBLER_BINDING_PROVIDER_FACTORY_FAILED",
  SCOPE_INVALID: "WARBLER_BINDING_SCOPE_INVALID",
  DUPLICATE_ID: "WARBLER_BINDING_DUPLICATE_ID",
  RUNTIME_CONTRACT_MISSING: "WARBLER_BINDING_RUNTIME_CONTRACT_MISSING",
} as const);

/** Creates an immutable executable-binding diagnostic. */
export function bindingDiagnostic(code: string, message: string, sourceFile: string, symbol: string): CompilerDiagnostic {
  return Object.freeze({ code, category: "error", message, sourceFile, line: 1, column: 1, relatedSymbols: Object.freeze([symbol]) });
}
