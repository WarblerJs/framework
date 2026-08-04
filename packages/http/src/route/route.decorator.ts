import { InvalidRouteError } from "../errors";
import { normalizePath } from "../internal";
import type { HttpMethodValue } from "./http-method";
import { setRouteMetadata } from "./route.metadata";
import type { HttpRouteOptions } from "./route.types";

type RouteHandler = (this: object, ...args: readonly unknown[]) => unknown;
type StandardRouteDecorator = <T extends RouteHandler>(handler: T, context: ClassMethodDecoratorContext) => T;
type CompatibleRouteDecorator = MethodDecorator & StandardRouteDecorator;

export function routeDecorator(method: HttpMethodValue, path: string, options: HttpRouteOptions): CompatibleRouteDecorator {
  const metadata = Object.freeze({
    ...options,
    guards: options.guards === undefined ? undefined : Object.freeze([...options.guards]),
    middleware:
      options.middleware === undefined ? undefined : Object.freeze([...options.middleware]),
    tags: options.tags === undefined ? undefined : Object.freeze([...options.tags]),
    method,
    path: normalizePath(path),
  });
  const decorate = (...arguments_: readonly unknown[]): unknown => {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new InvalidRouteError("Route timeout must be a positive safe integer");
    }
    const first = arguments_[0];
    const second = arguments_[1];
    if (typeof first === "function" && isDecoratorContext(second)) {
      if (second.private || second.static) throw new InvalidRouteError("HTTP routes must be public instance methods");
      setRouteMetadata(first, metadata);
      return first;
    }
    const descriptor = arguments_[2];
    if (!isMethodDescriptor(descriptor)) throw new InvalidRouteError("HTTP routes must decorate public instance methods");
    setRouteMetadata(descriptor.value, metadata);
    return undefined;
  };
  return decorate as CompatibleRouteDecorator;
}
function isDecoratorContext(value: unknown): value is ClassMethodDecoratorContext {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "method";
}
function isMethodDescriptor(value: unknown): value is TypedPropertyDescriptor<RouteHandler> & { readonly value: RouteHandler } {
  return typeof value === "object" && value !== null && "value" in value && typeof value.value === "function";
}
