/** Transport names recognized by Warbler. */
export const TRANSPORT_NAMES = [
  "http",
  "websocket",
  "tcp",
  "udp",
  "mcp",
  "webrtc",
] as const;

/** A transport name recognized by Warbler. */
export type TransportName = (typeof TRANSPORT_NAMES)[number];

/** Immutable network binding configuration. */
export interface NetworkConfig {
  readonly host: string;
  readonly bindInterface?: string;
}

/** Immutable transport activation configuration. */
export interface TransportActivationConfig {
  readonly enabled: boolean;
  readonly port?: number;
  readonly mode?: "shared-http" | "standalone";
  readonly signaling?: Readonly<{ port: number }>;
}

/** Immutable telemetry endpoint configuration. */
export interface TelemetryEndpointConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly path: string;
}

/** Immutable normalized runtime configuration. */
export interface RuntimeConfig {
  readonly network: NetworkConfig;
  readonly transports: Readonly<Record<TransportName, TransportActivationConfig>>;
  readonly telemetry: Readonly<{
    metrics: TelemetryEndpointConfig;
    healthCheck: TelemetryEndpointConfig;
  }>;
}

/** Values accepted as a configuration module's export. */
export type ConfigValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly ConfigValue[]
  | Readonly<{ readonly [key: string]: ConfigValue }>;
