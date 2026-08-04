import type { SocketGuardInput } from "@warbler/websocket";
import type { ChatMessageInput } from "./chat.validator";

export function chatGuard(input: SocketGuardInput<ChatMessageInput>): boolean {
  return input.message.data.roomId.trim().length > 0;
}
