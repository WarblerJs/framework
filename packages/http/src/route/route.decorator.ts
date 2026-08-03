import { InvalidRouteError } from "../errors";
import { normalizePath } from "../internal";
import type { HttpMethodValue } from "./http-method";
import { setRouteMetadata } from "./route.metadata";
import type { HttpRouteOptions } from "./route.types";

type RouteHandler = (this: object, ...args: readonly unknown[]) => unknown;

export function routeDecorator(method: HttpMethodValue, path: string, options: HttpRouteOptions) {
  return <T extends RouteHandler>(handler: T, context: ClassMethodDecoratorContext): T => {
    if (context.private || context.static) throw new InvalidRouteError("HTTP routes must be public instance methods");
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new InvalidRouteError("Route timeout must be a positive safe integer");
    }
    const metadata = Object.freeze({
      ...options,
      guards: options.guards === undefined ? undefined : Object.freeze([...options.guards]),
      middleware:
        options.middleware === undefined ? undefined : Object.freeze([...options.middleware]),
      tags: options.tags === undefined ? undefined : Object.freeze([...options.tags]),
      method,
      path: normalizePath(path),
    });
    setRouteMetadata(handler, metadata);
    return handler;
  };
}
