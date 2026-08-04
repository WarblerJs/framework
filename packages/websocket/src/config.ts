import { parseByteSize, parseDuration } from "@warbler/config";
import { WebSocketError } from "./errors";
import type { SocketMessageFormat } from "./message";
/** User WebSocket configuration. */
export interface WebSocketConfig {
  readonly mode?: "shared-http" | "dedicated";
  readonly security?: {
    readonly origins?: { readonly required?: boolean; readonly allowed?: readonly string[] };
    readonly hosts?: { readonly required?: boolean; readonly allowed?: readonly string[] };
    readonly protocols?: { readonly required?: boolean; readonly allowed?: readonly string[] };
    readonly authentication?: { readonly required?: boolean; readonly allowQueryToken?: boolean };
  };
  readonly messages?: {
    readonly format?: SocketMessageFormat; readonly maxPayloadLength?: string;
    readonly maxEventNameLength?: number; readonly maxMessageIdLength?: number;
    readonly unknownEvent?: "send-error" | "ignore" | "close";
  };
  readonly compression?: { readonly enabled?: boolean; readonly threshold?: string };
  readonly timeouts?: { readonly idle?: string; readonly handler?: string };
  readonly backpressure?: { readonly limit?: string; readonly closeOnLimit?: boolean; readonly strategy?: "reject-new" | "close" | "application" };
  readonly limits?: { readonly totalConnections?: number; readonly connectionsPerIp?: number; readonly subscriptionsPerConnection?: number; readonly eventsPerSecond?: number };
  readonly bun?: { readonly sendPings?: boolean; readonly publishToSelf?: boolean };
}
/** Fully validated immutable WebSocket configuration. */
export interface NormalizedWebSocketConfig {
  readonly mode: "shared-http" | "dedicated";
  readonly origins: Readonly<{ required: boolean; allowed: ReadonlySet<string> }>;
  readonly hosts: Readonly<{ required: boolean; allowed: ReadonlySet<string> }>;
  readonly protocols: Readonly<{ required: boolean; allowed: readonly string[] }>;
  readonly authentication: Readonly<{ required: boolean; allowQueryToken: boolean }>;
  readonly messages: Readonly<{ format: SocketMessageFormat; maxPayloadLength: number; maxEventNameLength: number; maxMessageIdLength: number; unknownEvent: "send-error" | "ignore" | "close" }>;
  readonly compression: Readonly<{ enabled: boolean; thresholdBytes: number }>;
  readonly timeouts: Readonly<{ idleSeconds: number; handlerMs: number }>;
  readonly backpressure: Readonly<{ limitBytes: number; closeOnLimit: boolean; strategy: "reject-new" | "close" | "application" }>;
  readonly limits: Readonly<{ totalConnections: number; connectionsPerIp: number; subscriptionsPerConnection: number; eventsPerSecond: number }>;
  readonly bun: Readonly<{ sendPings: boolean; publishToSelf: boolean }>;
}
function positive(value: unknown, fallback: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || (result as number) <= 0) throw new WebSocketError(`${field} must be a positive safe integer`);
  return result as number;
}
function origin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new WebSocketError(`Invalid allowed origin: ${value}`); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new WebSocketError(`Invalid allowed origin: ${value}`);
  return url.origin;
}
/** Strictly validates and normalizes WebSocket configuration. */
export function normalizeWebSocketConfig(input: WebSocketConfig = {}): NormalizedWebSocketConfig {
  const maxPayloadLength = parseByteSize(input.messages?.maxPayloadLength ?? "1mb");
  const idleMs = parseDuration(input.timeouts?.idle ?? "60s");
  if (idleMs <= 0 || idleMs % 1000 !== 0) throw new WebSocketError("WebSocket idle timeout must be positive whole seconds");
  const handlerMs = parseDuration(input.timeouts?.handler ?? "30s");
  if (handlerMs <= 0) throw new WebSocketError("Handler timeout must be positive");
  const format = input.messages?.format ?? "json";
  if (!["json", "text", "binary"].includes(format)) throw new WebSocketError("Unknown WebSocket message format");
  const strategy = input.backpressure?.strategy ?? "reject-new";
  if (!["reject-new", "close", "application"].includes(strategy)) throw new WebSocketError("Unknown backpressure strategy");
  const allowedProtocols = input.security?.protocols?.allowed ?? [];
  for (const protocol of allowedProtocols) if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(protocol)) throw new WebSocketError("Invalid WebSocket subprotocol");
  return Object.freeze({
    mode: input.mode ?? "shared-http",
    origins: Object.freeze({ required: input.security?.origins?.required ?? false, allowed: new Set((input.security?.origins?.allowed ?? []).map(origin)) }),
    hosts: Object.freeze({ required: input.security?.hosts?.required ?? false, allowed: new Set(input.security?.hosts?.allowed ?? []) }),
    protocols: Object.freeze({ required: input.security?.protocols?.required ?? false, allowed: Object.freeze([...allowedProtocols]) }),
    authentication: Object.freeze({ required: input.security?.authentication?.required ?? false, allowQueryToken: input.security?.authentication?.allowQueryToken ?? false }),
    messages: Object.freeze({ format, maxPayloadLength, maxEventNameLength: positive(input.messages?.maxEventNameLength, 128, "maxEventNameLength"), maxMessageIdLength: positive(input.messages?.maxMessageIdLength, 128, "maxMessageIdLength"), unknownEvent: input.messages?.unknownEvent ?? "send-error" }),
    compression: Object.freeze({ enabled: input.compression?.enabled ?? false, thresholdBytes: parseByteSize(input.compression?.threshold ?? "4kb") }),
    timeouts: Object.freeze({ idleSeconds: idleMs / 1000, handlerMs }),
    backpressure: Object.freeze({ limitBytes: parseByteSize(input.backpressure?.limit ?? "1mb"), closeOnLimit: input.backpressure?.closeOnLimit ?? true, strategy }),
    limits: Object.freeze({ totalConnections: positive(input.limits?.totalConnections, 10_000, "totalConnections"), connectionsPerIp: positive(input.limits?.connectionsPerIp, 20, "connectionsPerIp"), subscriptionsPerConnection: positive(input.limits?.subscriptionsPerConnection, 100, "subscriptionsPerConnection"), eventsPerSecond: positive(input.limits?.eventsPerSecond, 50, "eventsPerSecond") }),
    bun: Object.freeze({ sendPings: input.bun?.sendPings ?? true, publishToSelf: input.bun?.publishToSelf ?? false }),
  });
}
/** Validates WebSocket configuration and throws on invalid input. */
export function validateWebSocketConfig(input: WebSocketConfig): void { normalizeWebSocketConfig(input); }
