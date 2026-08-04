import { Repository } from "@warbler/core";

export interface StoredChatMessage {
  readonly id: string;
  readonly roomId: string;
  readonly content: string;
}

@Repository()
export default class ChatRepository {
  create(roomId: string, content: string): StoredChatMessage {
    return Object.freeze({ id: crypto.randomUUID(), roomId, content });
  }
}
