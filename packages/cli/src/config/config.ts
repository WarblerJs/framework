import { normalizeRuntimeConfig, type RuntimeConfig, type TransportName } from "@warbler/config";
import {
  validateHttpConfig, validateMcpConfig, validateTcpConfig, validateUdpConfig,
  validateWebrtcConfig, validateWebsocketConfig,
} from "@warbler/config/validator";
import type { DatabaseProjectConfig } from "@warbler/database";
import { resolve } from "node:path";

const TRANSPORTS = Object.freeze(["http", "websocket", "tcp", "udp", "mcp", "webrtc"] as const);
/** Loads normalized Runtime configuration through `@warbler/config`. */
export async function loadCLIConfig(projectRoot: string): Promise<RuntimeConfig> {
  const module = await import(resolve(projectRoot, "src/config/runtime.config.ts"));
  return normalizeRuntimeConfig(select(module, ["runtimeConfig"]));
}
/** Loads the `pg` section of `src/config/database.config.ts`. Assumes the file exists. */
export async function loadDatabaseConfig(projectRoot: string): Promise<DatabaseProjectConfig> {
  const module = await import(resolve(projectRoot, "src/config/database.config.ts"));
  const candidate = select(module, ["databaseConfig"]);
  if (typeof candidate !== "object" || candidate === null) throw new TypeError("Database configuration must be an object.");
  const pg = (candidate as Readonly<Record<string, unknown>>)["pg"];
  if (typeof pg !== "object" || pg === null) throw new TypeError("Database configuration must export a `pg` key.");
  return pg as DatabaseProjectConfig;
}
/** Returns enabled transport names in deterministic order. */
export function resolveEnabledTransports(config: RuntimeConfig): readonly TransportName[] {
  return Object.freeze(TRANSPORTS.filter((transport) => config.transports[transport].enabled));
}
/** Applies createApp({ transports }) as the application-level transport allowlist. */
export function applyApplicationTransports(config: RuntimeConfig, transports: readonly string[] | undefined): RuntimeConfig {
  const requested = new Set((transports ?? []).filter(isTransportName));
  if (requested.size === 0) return config;
  const normalized = normalizeRuntimeConfig(config);
  return Object.freeze({
    ...normalized,
    transports: Object.freeze(Object.fromEntries(TRANSPORTS.map((transport) => [
      transport,
      Object.freeze({ ...normalized.transports[transport], enabled: requested.has(transport) }),
    ]))) as RuntimeConfig["transports"],
  });
}
/** Loads only enabled transport configuration modules. */
export async function loadEnabledTransportConfigs(config: RuntimeConfig, projectRoot: string): Promise<ReadonlyMap<TransportName, Readonly<unknown>>> {
  const result = new Map<TransportName, Readonly<unknown>>();
  for (const transport of resolveEnabledTransports(config)) {
    const file = transport === "websocket" ? "ws.config.ts" : `${transport}.config.ts`;
    const module = await import(resolve(projectRoot, "src/config/transports", file));
    const names = transport === "websocket" ? ["wsConfig", "websocketConfig"] : [`${transport}Config`];
    const value = select(module, names);
    validate(transport, value);
    if (typeof value !== "object" || value === null) throw new TypeError(`${transport} configuration must be an object`);
    result.set(transport, Object.freeze(value));
  }
  return result;
}
function isTransportName(value: string): value is TransportName {
  return (TRANSPORTS as readonly string[]).includes(value);
}
function select(module: Readonly<Record<string, unknown>>, names: readonly string[]): unknown {
  for (const name of names) if (name in module) return module[name];
  if ("default" in module) return module.default;
  throw new TypeError(`Configuration export not found: ${names.join(", ")}`);
}
function validate(transport: TransportName, value: unknown): void {
  switch (transport) {
    case "http": validateHttpConfig(value); return;
    case "websocket": validateWebsocketConfig(value); return;
    case "tcp": validateTcpConfig(value); return;
    case "udp": validateUdpConfig(value); return;
    case "mcp": validateMcpConfig(value); return;
    case "webrtc": validateWebrtcConfig(value);
  }
}
