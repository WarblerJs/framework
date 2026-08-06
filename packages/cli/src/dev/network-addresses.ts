import { networkInterfaces } from "node:os";

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", ""]);

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/** Lists the HTTP URLs a dev server bound to `host`/`port` is actually reachable at. A wildcard host (`0.0.0.0`/`::`) is expanded into `localhost` plus every non-internal IPv4 LAN address, mirroring what tools like Vite print; any other host is reported as-is. */
export function resolveNetworkAddresses(host: string, port: number): readonly string[] {
  if (!WILDCARD_HOSTS.has(host)) return Object.freeze([`http://${formatHost(host)}:${port}`]);
  const addresses = [`http://localhost:${port}`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(`http://${entry.address}:${port}`);
    }
  }
  return Object.freeze(addresses);
}
