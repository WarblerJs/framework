import type { BunRouteTable } from "./bun-route-table";

/** Fallback handler used only after Bun native route matching fails. */
export type HttpFallbackHandler = (request: Request, server: Bun.Server<undefined>) => Response | Promise<Response>;

/** Validated options for native Bun HTTP server creation. */
export interface HttpNativeServerOptions {
  readonly hostname: string;
  readonly port: number;
  readonly development: boolean;
  readonly reusePort: boolean;
  readonly idleTimeoutSeconds?: number;
  readonly maxRequestBodySize: number;
  readonly routes: BunRouteTable;
  readonly fetch?: HttpFallbackHandler;
}

/** Injectable native server creation seam. */
export type HttpNativeServerFactory = (options: HttpNativeServerOptions) => Bun.Server<undefined>;
