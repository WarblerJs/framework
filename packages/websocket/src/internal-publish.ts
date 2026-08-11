import { Console } from "@warbler/console";
import { interpretSendResult, type SocketSendResult } from "./backpressure";
import { encodeSocketMessage, type SocketMessageFormat, type SocketOutgoingMessage } from "./message";
import { validateTopic } from "./pubsub";

/** Native publish target shared by socket contexts and application publishers. */
export interface SocketNativePublisher {
  publish(topic: string, data: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
}

/** Optional current-socket sender used when a context includes itself in a publish. */
export interface SocketNativeSelfSender {
  send(data: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
}

/** Immutable options for the package-internal Bun publish path. */
export interface InternalSocketPublishOptions {
  readonly format: SocketMessageFormat;
  readonly compress?: boolean;
  readonly includeSelf?: boolean;
  readonly self?: SocketNativeSelfSender;
  readonly connectionId?: string;
}

/** Publishes through Bun's native topic path after Warbler validation and encoding. */
export function internalPublish<TData>(
  target: SocketNativePublisher,
  topic: string,
  message: SocketOutgoingMessage<TData>,
  options: InternalSocketPublishOptions,
): SocketSendResult {
  const valid = validateTopic(topic);
  const encoded = encodeSocketMessage(message as SocketOutgoingMessage<unknown>, options.format);
  Console.socket({
    action: "outgoing",
    event: message.event,
    connectionId: options.connectionId ?? "publisher",
    size: encodedSize(encoded),
  });
  if (options.includeSelf === true && options.self !== undefined) options.self.send(encoded, options.compress);
  return interpretSendResult(target.publish(valid, encoded, options.compress));
}

function encodedSize(value: string | ArrayBuffer | Uint8Array): number {
  return typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
}
