import { ConfigError } from "../errors";
import { parseHost, parseNetworkInterface, parsePort } from "../parser";
import {
  TRANSPORT_NAMES,
  type RuntimeConfig,
  type TransportActivationConfig,
  type TransportName,
} from "../types";
import { booleanValue, exactKeys, oneOf, pathValue, record } from "../utils/validation";

function validateActivation(value: unknown, name: TransportName): TransportActivationConfig {
  const path = `runtime.transports.${name}`;
  const config = record(value, path);
  const allowed =
    name === "websocket"
      ? ["enabled", "port", "mode"]
      : name === "webrtc"
        ? ["enabled", "signaling"]
        : ["enabled", "port"];
  exactKeys(config, allowed, ["enabled"], path);
  const enabled = booleanValue(config.enabled, `${path}.enabled`);
  if (name === "webrtc") {
    if (!enabled && config.signaling === undefined) return Object.freeze({ enabled });
    const signaling = record(config.signaling, `${path}.signaling`);
    exactKeys(signaling, ["port"], ["port"], `${path}.signaling`);
    return Object.freeze({
      enabled,
      signaling: Object.freeze({ port: parsePort(signaling.port) }),
    });
  }
  if (!enabled && config.port === undefined && config.mode === undefined) return Object.freeze({ enabled });
  const port = parsePort(config.port);
  if (name === "websocket") {
    const mode = oneOf(config.mode, ["shared-http", "standalone"] as const, `${path}.mode`);
    return Object.freeze({ enabled, port, mode });
  }
  return Object.freeze({ enabled, port });
}

function validateEndpoint(value: unknown, path: string): RuntimeConfig["telemetry"]["metrics"] {
  const endpoint = record(value, path);
  exactKeys(endpoint, ["enabled", "host", "port", "path"], ["enabled", "host", "port", "path"], path);
  return Object.freeze({
    enabled: booleanValue(endpoint.enabled, `${path}.enabled`),
    host: parseHost(endpoint.host),
    port: parsePort(endpoint.port),
    path: pathValue(endpoint.path, `${path}.path`),
  });
}

/** Validates a complete runtime configuration and returns a typed immutable value. */
export function validateRuntimeConfig(value: unknown): RuntimeConfig {
  const runtime = record(value, "runtime");
  exactKeys(runtime, ["network", "transports", "telemetry"], ["network", "transports", "telemetry"], "runtime");
  const network = record(runtime.network, "runtime.network");
  exactKeys(network, ["host", "bindInterface"], ["host"], "runtime.network");
  const host = parseHost(network.host);
  const bindInterface =
    network.bindInterface === undefined
      ? undefined
      : parseNetworkInterface(network.bindInterface);
  const transportsValue = record(runtime.transports, "runtime.transports");
  exactKeys(transportsValue, TRANSPORT_NAMES, TRANSPORT_NAMES, "runtime.transports");
  const transports: Record<TransportName, TransportActivationConfig> = {
    http: validateActivation(transportsValue.http, "http"),
    websocket: validateActivation(transportsValue.websocket, "websocket"),
    tcp: validateActivation(transportsValue.tcp, "tcp"),
    udp: validateActivation(transportsValue.udp, "udp"),
    mcp: validateActivation(transportsValue.mcp, "mcp"),
    webrtc: validateActivation(transportsValue.webrtc, "webrtc"),
  };
  const telemetry = record(runtime.telemetry, "runtime.telemetry");
  exactKeys(telemetry, ["metrics", "healthCheck"], ["metrics", "healthCheck"], "runtime.telemetry");
  const networkConfig =
    bindInterface === undefined ? Object.freeze({ host }) : Object.freeze({ host, bindInterface });
  return Object.freeze({
    network: networkConfig,
    transports: Object.freeze(transports),
    telemetry: Object.freeze({
      metrics: validateEndpoint(telemetry.metrics, "runtime.telemetry.metrics"),
      healthCheck: validateEndpoint(telemetry.healthCheck, "runtime.telemetry.healthCheck"),
    }),
  });
}
