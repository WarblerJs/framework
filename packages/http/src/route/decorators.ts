import type { AnyRequestValidator } from "../request/app-request";
import { HttpMethod } from "./http-method";
import { routeDecorator } from "./route.decorator";
import type { HttpRouteOptions } from "./route.types";

/**
 * Each decorator has two overloads rather than one generic signature. `V` only has a
 * safe inference anchor when `options.validator` is actually present (a covariant
 * position); inferring it from `guards`/`middleware` alone (where the request type
 * appears contravariantly) doesn't reliably resolve to `undefined` when no validator
 * is given. The no-validator overload sidesteps that entirely by not being generic.
 */
type RouteDecoratorReturn = ReturnType<typeof routeDecorator>;

/** Marks a controller method as a GET route. */
export function Get(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Get<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Get(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.GET, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as a POST route. */
export function Post(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Post<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Post(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.POST, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as a PUT route. */
export function Put(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Put<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Put(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.PUT, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as a PATCH route. */
export function Patch(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Patch<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Patch(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.PATCH, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as a DELETE route. */
export function Delete(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Delete<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Delete(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.DELETE, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as an OPTIONS route. */
export function Options(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Options<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Options(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.OPTIONS, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as a HEAD route. */
export function Head(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Head<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Head(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.HEAD, path, options as unknown as HttpRouteOptions);
}
/** Marks a controller method as an SSE GET route. */
export function Sse(path?: string, options?: HttpRouteOptions<undefined>): RouteDecoratorReturn;
export function Sse<const V extends AnyRequestValidator>(path: string, options: HttpRouteOptions<V> & { readonly validator: V }): RouteDecoratorReturn;
export function Sse(path = "", options: HttpRouteOptions<any> = {}): RouteDecoratorReturn {
  return routeDecorator(HttpMethod.GET, path, Object.freeze({ ...options, stream: "sse" }) as unknown as HttpRouteOptions);
}
