import { InvalidRouteError, RouteConflictError } from "../errors";
import { joinPaths } from "../internal";
import type { BunMethodRouteTable, BunRouteTable } from "../native";
import type { CompiledHttpGraph } from "./compiled-http-graph";
import type { CompiledHttpRouteTable } from "./string-table.types";

/** Creates a Bun-native method route table without adding a custom matcher. */
export function createBunRoutes(graphs: readonly CompiledHttpGraph[]): BunRouteTable {
  const output: Record<string, BunMethodRouteTable> = Object.create(null);
  for (const graph of graphs) {
    for (const controller of graph.controllers) {
      for (const route of controller.routes) {
        const path = joinPaths(graph.prefix, controller.prefix, route.path);
        let methods = output[path];
        if (methods === undefined) {
          const created: BunMethodRouteTable = Object.create(null);
          output[path] = created;
          methods = created;
        }
        if (methods[route.method] !== undefined) throw new RouteConflictError(route.method, path);
        methods[route.method] = route.handler;
      }
    }
  }
  return Object.freeze(output);
}

/** Validates all compiled string, policy, and middleware IDs once before serving. */
export function validateCompiledHttpRouteTable(
  table: CompiledHttpRouteTable,
  csrfPolicyCount: number,
  validationPolicyCount: number,
  middlewareCount: number,
): void {
  for (const route of table.routes) {
    for (const id of [route.methodStringId, route.pathStringId, route.controllerStringId, route.handlerStringId]) {
      if (!Number.isSafeInteger(id) || id < 0 || id >= table.strings.length) {
        throw new InvalidRouteError("Compiled HTTP string ID is out of range");
      }
    }
    if (route.csrfPolicyId < 0 || route.csrfPolicyId >= csrfPolicyCount) throw new InvalidRouteError("Compiled CSRF policy ID is out of range");
    if (route.validationPolicyId < 0 || route.validationPolicyId >= validationPolicyCount) throw new InvalidRouteError("Compiled validation policy ID is out of range");
    if (route.middlewareStart < 0 || route.middlewareCount < 0 || route.middlewareStart + route.middlewareCount > middlewareCount) {
      throw new InvalidRouteError("Compiled middleware range is out of bounds");
    }
  }
}
