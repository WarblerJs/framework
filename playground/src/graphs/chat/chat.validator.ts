import type { SocketMessage, SocketValidationResult } from "@warbler/websocket";

export interface ChatMessageInput {
  readonly roomId: string;
  readonly content: string;
}

function validData(value: unknown): value is ChatMessageInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return typeof record.roomId === "string" && record.roomId.trim().length > 0
    && typeof record.content === "string" && record.content.trim().length > 0
    && record.content.length <= 2_000;
}

export function chatMessageValidator(input: unknown): SocketValidationResult {
  if (typeof input !== "object" || input === null || !("message" in input)) return Object.freeze({ valid: false });
  const message = input.message as SocketMessage<unknown>;
  return validData(message.data) ? true : Object.freeze({ valid: false });
}

export function roomJoinValidator(input: unknown): SocketValidationResult {
  if (typeof input !== "object" || input === null || !("message" in input)) return Object.freeze({ valid: false });
  const message = input.message as SocketMessage<unknown>;
  return typeof message.data === "object" && message.data !== null
    && "roomId" in message.data && typeof message.data.roomId === "string"
    && message.data.roomId.trim().length > 0
    ? true
    : Object.freeze({ valid: false });
}
