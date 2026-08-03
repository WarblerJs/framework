import { HttpMethod } from "./http-method";
import { routeDecorator } from "./route.decorator";
import type { HttpRouteOptions } from "./route.types";

/** Marks a controller method as a GET route. */
export function Get(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.GET, path, options); }
/** Marks a controller method as a POST route. */
export function Post(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.POST, path, options); }
/** Marks a controller method as a PUT route. */
export function Put(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.PUT, path, options); }
/** Marks a controller method as a PATCH route. */
export function Patch(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.PATCH, path, options); }
/** Marks a controller method as a DELETE route. */
export function Delete(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.DELETE, path, options); }
/** Marks a controller method as an OPTIONS route. */
export function Options(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.OPTIONS, path, options); }
/** Marks a controller method as a HEAD route. */
export function Head(path = "", options: HttpRouteOptions = {}) { return routeDecorator(HttpMethod.HEAD, path, options); }
/** Marks a controller method as an SSE GET route. */
export function Sse(path = "", options: HttpRouteOptions = {}) {
  return routeDecorator(HttpMethod.GET, path, Object.freeze({ ...options, stream: "sse" }));
}
