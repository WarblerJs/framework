import { ViewError } from "@warbler/view";

/**
 * View-domain errors raised by the `route()` template built-in. Defined here (not in
 * `@warbler/view`, which has no concept of routing) but extending `ViewError` so
 * `evaluateExpression`'s "rethrow known view errors as-is" branch preserves their
 * identity instead of flattening them into a generic `TemplateExpressionError`.
 */
export class ViewRouteNotFoundError extends ViewError {
  public constructor(public readonly routeName: string) {
    super(`Route "${routeName}" is not registered.`, "VIEW1005");
    this.name = "ViewRouteNotFoundError";
  }
}

/** Thrown when `route(name, ...params)` is called with fewer params than the route path requires. */
export class ViewRouteParameterMissingError extends ViewError {
  public constructor(
    public readonly routeName: string,
    public readonly parameterName: string,
  ) {
    super(`Route "${routeName}" is missing required parameter "${parameterName}".`, "VIEW1006");
    this.name = "ViewRouteParameterMissingError";
  }
}
