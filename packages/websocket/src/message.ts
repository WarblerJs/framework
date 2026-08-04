import { WebSocketMessageError, WebSocketPayloadError } from "./errors";
/** Supported compiled message representations. */
export type SocketMessageFormat = "json" | "text" | "binary";
/** Incoming application event envelope. */
export interface SocketMessage<TData = unknown> { readonly id?: string; readonly event: string; readonly data: TData }
/** Outgoing application event envelope. */
export interface SocketOutgoingMessage<TData = unknown> {
  readonly id?: string; readonly event: string; readonly data: TData;
  readonly error?: Readonly<{ code: string; message: string }>;
}
/** Envelope decoding constraints. */
export interface SocketDecodeOptions {
  readonly format?: SocketMessageFormat;
  readonly maxEventNameLength?: number;
  readonly maxMessageIdLength?: number;
}
function polluted(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "__proto__") ||
    Object.prototype.hasOwnProperty.call(value, "prototype") ||
    Object.prototype.hasOwnProperty.call(value, "constructor");
}
/** Decodes one Bun message without copying binary payloads. */
export function decodeSocketMessage(message: string | ArrayBuffer | Uint8Array, options: SocketDecodeOptions = {}): SocketMessage<unknown> {
  const format = options.format ?? "json";
  if (format === "binary") return { event: "binary", data: message };
  if (typeof message !== "string") throw new WebSocketPayloadError(`${format} messages must be text frames`);
  if (format === "text") return { event: "message", data: message };
  let parsed: unknown;
  try { parsed = JSON.parse(message); } catch (cause) { throw new WebSocketMessageError("Malformed JSON message", { cause }); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || polluted(parsed))
    throw new WebSocketMessageError("Message must be a safe object envelope");
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.event !== "string" || envelope.event.length === 0) throw new WebSocketMessageError("Message event is required");
  if (envelope.event.length > (options.maxEventNameLength ?? 128)) throw new WebSocketPayloadError("Message event is too long");
  if (envelope.id !== undefined && (typeof envelope.id !== "string" || envelope.id.length > (options.maxMessageIdLength ?? 128)))
    throw new WebSocketPayloadError("Message id is invalid");
  return envelope.id === undefined
    ? { event: envelope.event, data: envelope.data }
    : { id: envelope.id, event: envelope.event, data: envelope.data };
}
/** Encodes an outgoing envelope once for Bun send/publish. */
export function encodeSocketMessage(message: SocketOutgoingMessage<unknown>, format: SocketMessageFormat = "json"): string | ArrayBuffer | Uint8Array {
  if (format === "json") return JSON.stringify(message);
  if (format === "text") return typeof message.data === "string" ? message.data : JSON.stringify(message.data);
  if (message.data instanceof ArrayBuffer || message.data instanceof Uint8Array) return message.data;
  throw new WebSocketPayloadError("Binary outgoing data must be ArrayBuffer or Uint8Array");
}
