import { renderCsrfField } from "./view-builtins";
import { requireViewRequestScope } from "./view-request-scope";

/**
 * Explicit CSRF view data returned by `csrf()`, for passing through `view()`'s `data`.
 * Carries an index signature (in addition to the two named fields) so it structurally
 * satisfies `ViewData`'s nested-record shape when embedded as `{ security: csrf() }`.
 */
export interface CsrfViewData {
  /** Trusted hidden `<input>` markup — intended for raw interpolation (`{{{ security.field }}}`). */
  readonly field: string;
  /** The current request's raw CSRF token — follows normal escaped interpolation (`{{ security.token }}`). */
  readonly token: string;
  readonly [key: string]: string;
}

/**
 * Explicit CSRF access for `view("home", { security: csrf() })`. Reads the same
 * request-scoped, memoized token as the `csrfField`/`csrfToken` built-ins — within one
 * request, `csrf().token === csrfToken` always holds.
 */
export function csrf(): CsrfViewData {
  const scope = requireViewRequestScope();
  const token = scope.issueCsrfToken();
  return Object.freeze({ token, field: renderCsrfField(scope.csrfFieldName, token) });
}
