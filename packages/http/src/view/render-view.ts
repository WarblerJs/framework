import {
  assertNoReservedViewData,
  View,
  type ViewData,
  type ViewResponseOptions,
} from "@warblerjs/view";
import { buildViewBuiltins, RESERVED_VIEW_BUILTIN_NAMES } from "./view-builtins";
import { requireViewRequestScope } from "./view-request-scope";
import { viewErrorResponse } from "./view-error-response";

/**
 * Renders a Warbler view with framework built-ins (`tr`, `asset`, `route`, `csrfField`,
 * `csrfToken`) available automatically — the application-facing replacement for calling
 * `@warblerjs/view`'s `View()` directly. Never throws: any failure while validating
 * reserved names, resolving built-ins, or rendering (parsing, compilation, expression
 * evaluation, helper execution, layouts, partials, imports, missing templates) is
 * caught and converted into a safe development or production `Response` instead of
 * propagating as an unhandled rejection.
 */
export function view(
  name: string,
  data: ViewData = Object.freeze({}),
  options: ViewResponseOptions = Object.freeze({}),
): Response {
  const scope = requireViewRequestScope();
  try {
    assertNoReservedViewData(data, RESERVED_VIEW_BUILTIN_NAMES);
    return View(name, data, { ...options, builtins: buildViewBuiltins(scope) });
  } catch (error) {
    return viewErrorResponse(error, scope.request, scope.development);
  }
}
