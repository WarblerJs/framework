import { joinPaths } from "../internal";
import { buildNamedRouteTable, resolveRouteUrl, type NamedRouteTable } from "../route";
import type { StaticPolicy } from "../static";

/** Builds the process-wide `asset(path)` resolver once, from the static-asset policy. */
export function createAssetResolver(policy: StaticPolicy): (path: string) => string {
  return (path: string): string => joinPaths(policy.prefix, path);
}

/**
 * Decodes named routes straight out of the dense `routeRecords` the Runtime already
 * forwards for CSRF/SSE flag lookup (`nameId` rides along for free — it's just another
 * field on the same compiler-generated `RouteTableEntry` row — so no new generated
 * artifact or Runtime plumbing is needed for `route()`).
 */
export function decodeNamedRouteRows(
  records: readonly Readonly<Record<string, unknown>>[],
  strings: readonly string[],
): readonly Readonly<{ name: string; method: string; path: string }>[] {
  const decoded: Readonly<{ name: string; method: string; path: string }>[] = [];
  for (const record of records) {
    const nameId = record.nameId;
    const methodId = record.methodId;
    const pathId = record.pathId;
    if (typeof nameId !== "number" || nameId < 0 || typeof methodId !== "number" || typeof pathId !== "number") continue;
    const name = strings[nameId];
    const method = strings[methodId];
    const path = strings[pathId];
    if (name !== undefined && method !== undefined && path !== undefined) {
      decoded.push(Object.freeze({ name, method, path }));
    }
  }
  return Object.freeze(decoded);
}

/** Builds the process-wide `route(name, ...params)` resolver once, from the compiled named-route table. */
export function createRouteResolver(table: NamedRouteTable): (name: string, params: readonly (string | number)[]) => string {
  return (name: string, params: readonly (string | number)[]): string => resolveRouteUrl(table, name, params);
}

export { buildNamedRouteTable };
