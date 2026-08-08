import type { HttpMethodValue } from "../route";
import type { CsrfTokenSource } from "./csrf-token-source";

/** Precomputed CSRF validation policy. */
export interface CsrfPolicy {
  readonly enabled: boolean;
  readonly methods: readonly HttpMethodValue[];
  readonly headerName: string;
  readonly cookieName: string;
  /** Form field name used by the `csrfField` view built-in's hidden input (default `_csrf`). */
  readonly fieldName: string;
  readonly sources: readonly CsrfTokenSource[];
  readonly strictSources: boolean;
}

/** Result of CSRF request verification. */
export interface CsrfVerification {
  readonly valid: boolean;
  readonly reason?: "disabled" | "safe-method" | "missing" | "conflict" | "invalid";
  /** Which source supplied the accepted token. Only present when `valid` is `true`. */
  readonly source?: CsrfTokenSource;
}
