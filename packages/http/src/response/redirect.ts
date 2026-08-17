import { ServerStateError } from "../errors";
import { getViewRequestScope } from "../view/view-request-scope";
import { RedirectRes } from "./basic-responses";

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;
export type RouteParameter = string | number;

type NamedRouteRedirectResolver = (name: string, params: readonly RouteParameter[], status: RedirectStatus) => Response;

let namedRouteRedirectResolver: NamedRouteRedirectResolver | undefined;

export function configureNamedRouteRedirectResolver(resolver: NamedRouteRedirectResolver): void {
  namedRouteRedirectResolver = resolver;
}

/** Creates a native redirect response for an explicit path or URL. */
export function redirect(location: string, status: RedirectStatus = 302): Response {
  return RedirectRes(location, status);
}

export function redirectTo(name: string): Response;
export function redirectTo(name: string, status: RedirectStatus): Response;
export function redirectTo(name: string, params: readonly RouteParameter[], status?: RedirectStatus): Response;
/** Creates a redirect response to a precompiled named route. */
export function redirectTo(
  name: string,
  paramsOrStatus?: readonly RouteParameter[] | RedirectStatus,
  status: RedirectStatus = 302,
): Response {
  const hasParams = isRouteParameterArray(paramsOrStatus);
  const params = hasParams ? paramsOrStatus : EMPTY_ROUTE_PARAMETERS;
  const redirectStatus = hasParams ? status : paramsOrStatus ?? 302;
  const scope = getViewRequestScope();
  if (scope !== undefined) return redirect(scope.resolveRoute(name, params), redirectStatus);
  if (namedRouteRedirectResolver !== undefined) return namedRouteRedirectResolver(name, params, redirectStatus);
  throw new ServerStateError(
    "redirectTo() was called before HTTP named routes were initialized. " +
    "It can only be used from an active HTTP request or after the HTTP transport starts.",
  );
}

const EMPTY_ROUTE_PARAMETERS: readonly RouteParameter[] = Object.freeze([]);

function isRouteParameterArray(
  value: readonly RouteParameter[] | RedirectStatus | undefined,
): value is readonly RouteParameter[] {
  return Array.isArray(value);
}
