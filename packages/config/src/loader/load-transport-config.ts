import { discoverTransportConfig } from "../discovery";
import { ConfigError } from "../errors";
import type { RuntimeConfig, TransportName } from "../types";
import { freezeDeep } from "../utils/freeze";
import {
  validateHttpConfig,
  validateMcpConfig,
  validateTcpConfig,
  validateUdpConfig,
  validateWebrtcConfig,
  validateWebsocketConfig,
} from "../validator";
import { importConfig, selectExport } from "./module-loader";

const EXPORT_NAMES: Readonly<Record<TransportName, readonly string[]>> = Object.freeze({
  http: Object.freeze(["httpConfig"]),
  websocket: Object.freeze(["wsConfig", "websocketConfig"]),
  tcp: Object.freeze(["tcpConfig"]),
  udp: Object.freeze(["udpConfig"]),
  mcp: Object.freeze(["mcpConfig"]),
  webrtc: Object.freeze(["webrtcConfig"]),
});

function validateTransport(transport: TransportName, value: unknown): void {
  switch (transport) {
    case "http":
      validateHttpConfig(value);
      return;
    case "websocket":
      validateWebsocketConfig(value);
      return;
    case "tcp":
      validateTcpConfig(value);
      return;
    case "udp":
      validateUdpConfig(value);
      return;
    case "mcp":
      validateMcpConfig(value);
      return;
    case "webrtc":
      validateWebrtcConfig(value);
  }
}

/** Lazily loads an enabled transport configuration and returns undefined when disabled. */
export async function loadTransportConfig(
  transport: TransportName,
  runtime: RuntimeConfig,
  workspaceRoot = process.cwd(),
): Promise<Readonly<unknown> | undefined> {
  if (!runtime.transports[transport].enabled) return undefined;
  const path = await discoverTransportConfig(transport, workspaceRoot);
  const module = await importConfig(path);
  const value = selectExport(module, EXPORT_NAMES[transport], path);
  validateTransport(transport, value);
  if (typeof value !== "object" || value === null) {
    throw new ConfigError("transport configuration must be an object", path);
  }
  return freezeDeep(value);
}
