import type { ViewBuiltins } from "@warbler/view";
import type { ViewRequestScope } from "./view-request-scope";

/** Framework built-in names application `view()` data may never define. */
export const RESERVED_VIEW_BUILTIN_NAMES = Object.freeze([
  "tr",
  "asset",
  "route",
  "csrfField",
  "csrfToken",
] as const);

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Renders the trusted hidden CSRF input shared by the `csrfField` built-in and `csrf().field`. */
export function renderCsrfField(fieldName: string, token: string): string {
  return `<input type="hidden" name="${escapeAttribute(fieldName)}" value="${escapeAttribute(token)}">`;
}

const localizedTranslate = (request: Request): ((key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => string) => {
  const candidate = (request as Request & { readonly tr?: unknown }).tr;
  return typeof candidate === "function"
    ? candidate as (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => string
    : (key: string) => key;
};

/** Assembles the framework built-ins made available to every template render, from the active request scope. */
export function buildViewBuiltins(scope: ViewRequestScope): ViewBuiltins {
  const token = scope.issueCsrfToken();

  return Object.freeze({
    tr: (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) =>
      localizedTranslate(scope.request)(key, parameters),
    asset: (path: string) => scope.resolveAsset(path),
    route: (name: string, ...params: readonly (string | number)[]) => scope.resolveRoute(name, params),
    csrfToken: token,
    csrfField: renderCsrfField(scope.csrfFieldName, token),
  });
}
