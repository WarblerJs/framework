import type { HttpNativeServerFactory } from "./native-server.types";

/** Creates a native Bun server with normal routing delegated entirely to Bun routes. */
export const createBunNativeServer: HttpNativeServerFactory = (options) => {
  const base = {
    hostname: options.hostname,
    port: options.port,
    development: options.development,
    reusePort: options.reusePort,
    idleTimeout: options.idleTimeoutSeconds,
    maxRequestBodySize: options.maxRequestBodySize,
    routes: options.routes,
  };
  if (options.fetch === undefined) return Bun.serve(base);
  return Bun.serve({ ...base, fetch: options.fetch });
};
