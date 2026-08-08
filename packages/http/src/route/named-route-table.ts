import { ViewRouteNotFoundError, ViewRouteParameterMissingError } from "./route-view-errors";

interface NamedRouteEntry {
  readonly method: string;
  readonly path: string;
  readonly paramNames: readonly string[];
}

/** Compile/startup-resolved lookup from a route's logical `name` to its method/path/params. */
export type NamedRouteTable = ReadonlyMap<string, NamedRouteEntry>;

const paramNamesOf = (path: string): readonly string[] =>
  Object.freeze(path.split("/").filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1)));

/**
 * Builds the name → route lookup table once, at HTTP transport startup — never scanned
 * or rebuilt per render. `:param` tokens are parsed out of each path exactly once here.
 */
export function buildNamedRouteTable(rows: readonly Readonly<{ name: string; method: string; path: string }>[]): NamedRouteTable {
  const table = new Map<string, NamedRouteEntry>();
  for (const row of rows) {
    table.set(row.name, Object.freeze({ method: row.method, path: row.path, paramNames: paramNamesOf(row.path) }));
  }
  return table;
}

/** Fills a named route's `:param` path segments from positional values, URL-encoding each. */
export function resolveRouteUrl(table: NamedRouteTable, name: string, params: readonly (string | number)[]): string {
  const route = table.get(name);
  if (route === undefined) throw new ViewRouteNotFoundError(name);
  let index = 0;
  const segments = route.path.split("/").map((segment) => {
    if (!segment.startsWith(":")) return segment;
    const paramName = segment.slice(1);
    const value = params[index];
    index += 1;
    if (value === undefined) throw new ViewRouteParameterMissingError(name, paramName);
    return encodeURIComponent(String(value));
  });
  return segments.join("/");
}
