import { WebSocketPayloadError } from "./errors";
/** A validated Bun Pub/Sub topic. */
export type SocketTopic = string;
/** Validates an application topic and returns it unchanged. */
export function validateTopic(topic: string, maximumLength = 256): SocketTopic {
  if (typeof topic !== "string" || topic.length === 0 || topic.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(topic))
    throw new WebSocketPayloadError("Invalid socket topic");
  if (topic.startsWith("@warblerjs/")) throw new WebSocketPayloadError("Reserved socket topic");
  return topic;
}
/** Native topic subscription contract. */
export interface SocketSubscription { readonly topic: SocketTopic; readonly subscribed: boolean }
