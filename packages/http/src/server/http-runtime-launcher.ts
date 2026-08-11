import type { RuntimeTransportLauncher, RuntimeTransportStartInput, RuntimeTransportStopOptions } from "@warbler/transport";
import { createBunRouteHandler, type BunRouteTable } from "../native";
import { normalizeHttpConfig } from "../config";
import { RouteFlag } from "../compiled";
import { CsrfVerifier } from "../csrf";
import { createSecurityHeaderTemplate } from "../security";
import { createStaticRouteTable } from "../static";
import { createHttpServerOwner } from "./create-http-server-owner";
import type { HttpServer } from "./http-server.types";
import { createViewDevelopmentRoutes } from "@warbler/view";
import {
  buildNamedRouteTable,
  createAssetResolver,
  createRouteResolver,
  decodeNamedRouteRows,
} from "../view/builtin-resolvers";

interface TransportLoggingConfig {
  readonly requests?: boolean;
  readonly errors?: boolean;
}

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
      const logging = transportLogging(input.config);
      const routes: Record<string, unknown> = {
        ...await createStaticRouteTable(process.cwd(), config.static, config.development),
        ...(config.development ? createViewDevelopmentRoutes() : {}),
      };
      // Always minted (even when global CSRF enforcement is disabled): token *issuance*
      // for csrfField/csrfToken/csrf() is independent of whether routes enforce
      // verification, and CsrfVerifier.verify() already no-ops per-request when
      // policy.enabled is false and verification isn't forced by a route flag.
      const csrf = Object.freeze({
        verifier: await CsrfVerifier.create(process.env.WARBLER_CSRF_SECRET ?? crypto.randomUUID().replaceAll("-", "").repeat(2)),
        policy: config.csrf,
      });
      const securityHeaders = createSecurityHeaderTemplate(config.security);
      const strings = input.bindings.strings ?? [];
      const routeNameTable = buildNamedRouteTable(decodeNamedRouteRows(input.bindings.routeRecords ?? [], strings));
      const builtins = Object.freeze({
        asset: createAssetResolver(config.static),
        route: createRouteResolver(routeNameTable),
      });
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
            csrf,
            builtins,
            development: config.development,
            logging,
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

function transportLogging(config: unknown): TransportLoggingConfig {
  if (typeof config !== "object" || config === null || !("logging" in config)) return Object.freeze({});
  const logging = config.logging;
  if (typeof logging !== "object" || logging === null) return Object.freeze({});
  const record = logging as Readonly<Record<string, unknown>>;
  return Object.freeze({
    ...(typeof record.requests === "boolean" ? { requests: record.requests } : {}),
    ...(typeof record.errors === "boolean" ? { errors: record.errors } : {}),
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
