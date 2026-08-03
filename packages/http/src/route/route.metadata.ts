import type { HttpRouteMetadata } from "./route.types";

const routes = new WeakMap<Function, HttpRouteMetadata>();

/** Reads immutable route metadata from a decorated handler function. */
export function getRouteMetadata(handler: Function): HttpRouteMetadata | undefined {
  return routes.get(handler);
}

export function setRouteMetadata(handler: Function, metadata: HttpRouteMetadata): void {
  routes.set(handler, metadata);
}
