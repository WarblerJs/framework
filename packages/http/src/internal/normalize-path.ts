import { InvalidRouteError } from "../errors";

/** Normalizes a route path without resolving unsafe traversal segments. */
export function normalizePath(value = ""): string {
  if (value.includes("\0")) throw new InvalidRouteError("Route path contains a null byte");
  const rawSegments = value.split("/");
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (segment === ".." || segment === ".") {
      throw new InvalidRouteError("Route paths must not contain dot segments");
    }
    if (segment.length > 0) segments.push(segment);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** Joins route prefixes into one normalized absolute route path. */
export function joinPaths(...values: readonly string[]): string {
  let result = "";
  for (const value of values) {
    const normalized = normalizePath(value);
    if (normalized !== "/") result += normalized;
  }
  return result.length === 0 ? "/" : result;
}

/** Validates normalized route path byte and parameter limits. */
export function validatePathLimits(path: string, maxSize: number, maxParams: number): void {
  if (new TextEncoder().encode(path).byteLength > maxSize) {
    throw new InvalidRouteError("Route path exceeds configured byte limit", { path, maxSize });
  }
  let parameters = 0;
  const segments = path.split("/");
  for (const segment of segments) if (segment.startsWith(":")) parameters++;
  if (parameters > maxParams) {
    throw new InvalidRouteError("Route path exceeds configured parameter limit", { path, maxParams });
  }
}
