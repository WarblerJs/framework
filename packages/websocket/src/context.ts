import { interpretSendResult, type SocketSendResult } from "./backpressure";
import { Console } from "@warbler/console";
import type { TranslationParameters } from "@warbler/i18n";
import { encodeSocketMessage, type SocketMessageFormat, type SocketOutgoingMessage } from "./message";
import { validateTopic } from "./pubsub";
/** Safe connection details exposed to controllers. */
export interface SocketConnection { readonly id: string; readonly connectedAt: number; readonly remoteAddress?: string }
/** Optional low-overhead application logger. */
export interface SocketLogger { debug?(message: string, metadata?: Readonly<Record<string, unknown>>): void; info?(message: string, metadata?: Readonly<Record<string, unknown>>): void; warn?(message: string, metadata?: Readonly<Record<string, unknown>>): void; error(error: unknown, metadata?: Readonly<Record<string, unknown>>): void }
/** Bun-native operations needed by a socket context. */
export interface NativeSocketLike {
  send(data: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
  publish(topic: string, data: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
  subscribe(topic: string): boolean | void; unsubscribe(topic: string): boolean | void; isSubscribed(topic: string): boolean;
  close(code?: number, reason?: string): void; cork<T>(callback: () => T): T;
}
/** Controller-facing per-socket context. */
export interface SocketContext<TUser = unknown> {
  readonly connection: SocketConnection; readonly user?: TUser; readonly subscriptions: readonly string[]; readonly log: SocketLogger; readonly locale: string;
  tr(key: string, parameters?: TranslationParameters): string;
  send<TData>(message: SocketOutgoingMessage<TData>, options?: { readonly compress?: boolean }): SocketSendResult;
  publish<TData>(topic: string, message: SocketOutgoingMessage<TData>, options?: { readonly compress?: boolean; readonly includeSelf?: boolean }): SocketSendResult;
  join(topic: string): boolean; leave(topic: string): boolean; isJoined(topic: string): boolean;
  close(code?: number, reason?: string): void; cork<T>(callback: () => T): T;
}
const silentLogger: SocketLogger = Object.freeze({ error(): void {} });
/** Sanitizes a WebSocket close reason to its protocol limit. */
export function safeCloseReason(reason: string): string {
  const clean = reason.replace(/[\u0000-\u001f\u007f]/gu, " ");
  const bytes = new TextEncoder().encode(clean);
  if (bytes.byteLength <= 123) return clean;
  return new TextDecoder().decode(bytes.subarray(0, 123)).replace(/\uFFFD$/u, "");
}
/** Creates a thin context over Bun's native socket APIs. */
export function createSocketContext<TUser>(socket: NativeSocketLike, connection: SocketConnection, options: { readonly user?: TUser; readonly format?: SocketMessageFormat; readonly subscriptionLimit?: number; readonly logger?: SocketLogger; readonly locale?: string; readonly translate?: (key: string, parameters?: TranslationParameters) => string } = {}): SocketContext<TUser> {
  const topics = new Set<string>();
  const format = options.format ?? "json";
  return {
    connection: Object.freeze({ ...connection }), user: options.user, get subscriptions(): readonly string[] { return Object.freeze([...topics]); }, log: options.logger ?? silentLogger,
    locale: options.locale ?? "en",
    tr(key, parameters) { return options.translate?.(key, parameters) ?? key; },
    send(message, sendOptions) {
      const encoded = encodeSocketMessage(message as SocketOutgoingMessage<unknown>, format);
      Console.socket({ action: "outgoing", event: message.event, connectionId: connection.id, size: encodedSize(encoded) });
      return interpretSendResult(socket.send(encoded, sendOptions?.compress));
    },
    publish(topic, message, publishOptions) {
      const valid = validateTopic(topic);
      const encoded = encodeSocketMessage(message as SocketOutgoingMessage<unknown>, format);
      Console.socket({ action: "outgoing", event: message.event, connectionId: connection.id, size: encodedSize(encoded) });
      if (publishOptions?.includeSelf) socket.send(encoded, publishOptions.compress);
      return interpretSendResult(socket.publish(valid, encoded, publishOptions?.compress));
    },
    join(topic) { const valid = validateTopic(topic); if (topics.size >= (options.subscriptionLimit ?? 100) && !topics.has(valid)) return false; const result = socket.subscribe(valid); if (result !== false) topics.add(valid); return result !== false; },
    leave(topic) { const valid = validateTopic(topic); const result = socket.unsubscribe(valid); if (result !== false) topics.delete(valid); return result !== false; },
    isJoined(topic) { return socket.isSubscribed(validateTopic(topic)); },
    close(code = 1000, reason = "") { if (!Number.isInteger(code) || code < 1000 || code > 4999 || code === 1004 || code === 1005 || code === 1006 || code === 1015) throw new RangeError("Invalid WebSocket close code"); socket.close(code, safeCloseReason(reason)); },
    cork(callback) { return socket.cork(callback); },
  };
}
function encodedSize(value: string | ArrayBuffer | Uint8Array): number {
  return typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
}
