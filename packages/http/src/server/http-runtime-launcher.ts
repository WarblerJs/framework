import type { RuntimeTransportLauncher, RuntimeTransportStartInput, RuntimeTransportStopOptions } from "@warbler/transport";
import { createBunRouteHandler, type BunRouteTable } from "../native";
import { normalizeHttpConfig } from "../config";
import { RouteFlag } from "../compiled";
import { CsrfVerifier } from "../csrf";
import { createSecurityHeaderTemplate } from "../security";
import { createStaticRouteTable } from "../static";
import { createHttpServerOwner } from "./create-http-server-owner";
import type { HttpServer } from "./http-server.types";

/** Generated HTTP bindings supplied by Runtime after one-time pipeline compilation. */
export interface HttpRuntimeBindings {
  readonly routes: BunRouteTable;
  readonly routeRecords?: readonly Readonly<Record<string, unknown>>[];
  readonly strings?: readonly string[];
}
/** Creates the package-owned Runtime launcher for Bun native HTTP routes. */
export function createHttpRuntimeLauncher(): RuntimeTransportLauncher<HttpRuntimeBindings, unknown, HttpServer> {
  return Object.freeze({
    kind: "http",
    async start(input: RuntimeTransportStartInput<HttpRuntimeBindings, unknown>) {
      const config = normalizeHttpConfig(input.config);
      const routes: Record<string, unknown> = {
        ...await createStaticRouteTable(process.cwd(), config.static),
      };
      const csrf = config.csrf.enabled
        ? Object.freeze({
          verifier: await CsrfVerifier.create(process.env.WARBLER_CSRF_SECRET ?? crypto.randomUUID().replaceAll("-", "").repeat(2)),
          policy: config.csrf,
        })
        : undefined;
      const securityHeaders = createSecurityHeaderTemplate(config.security);
      for (const [path, methods] of Object.entries(input.bindings.routes)) {
        if (typeof methods !== "object" || methods === null || methods instanceof Response || methods instanceof Blob) {
          routes[path] = methods;
          continue;
        }
        const wrapped: Record<string, unknown> = {};
        for (const [method, handler] of Object.entries(methods)) {
          if (typeof handler !== "function") {
            wrapped[method] = handler;
            continue;
          }
          const flags = routeFlags(input.bindings, path, method);
          wrapped[method] = createBunRouteHandler({
            handler,
            flags,
            allowedHosts: config.allowedHosts,
            headers: config.limits.headers,
            securityHeaders,
            ...(csrf === undefined ? {} : { csrf }),
          });
        }
        routes[path] = Object.freeze(wrapped);
      }
      const owner = createHttpServerOwner({
        hostname: config.host,
        port: config.port,
        development: config.development,
        reusePort: config.reusePort,
        ...(config.idleTimeoutSeconds === undefined ? {} : { idleTimeoutSeconds: config.idleTimeoutSeconds }),
        maxRequestBodySize: config.maxRequestBodySize,
        routes: Object.freeze(routes) as BunRouteTable,
      });
      owner.start();
      return owner;
    },
    stop(handle: HttpServer, options: RuntimeTransportStopOptions) { return handle.stop(options.closeActiveConnections ?? false); },
  });
}
function routeFlags(bindings: HttpRuntimeBindings, path: string, method: string): number {
  const records = bindings.routeRecords;
  const strings = bindings.strings;
  if (records === undefined || strings === undefined) return 0;
  for (const record of records) {
    const pathId = record.pathId;
    const methodId = record.methodId;
    if (typeof pathId === "number" && typeof methodId === "number" && strings[pathId] === path && strings[methodId] === method) {
      if (typeof record.flags !== "number") return 0;
      const compilerFlags = record.flags;
      return (compilerFlags & (1 << 10) ? RouteFlag.CSRF_ENABLED : 0)
        | (compilerFlags & (1 << 11) ? RouteFlag.SSE : 0);
    }
  }
  return 0;
}
