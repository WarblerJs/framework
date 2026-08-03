// @ts-nocheck
import { Repository } from "@warbler/core";

@Repository()
export default class ChatRepository {
    async saveConnection(input: {
        readonly connectionId: string;
        readonly userId?: string;
    }): Promise<void> {
        console.log("Connected:", input);
    }

    async addConnectionToRoom(input: {
        readonly connectionId: string;
        readonly roomId: string;
    }): Promise<void> {
        console.log("Room joined:", input);
    }

    async createMessage(input: {
        readonly userId?: string;
        readonly roomId: string;
        readonly content: string;
    }) {
        return {
            id: crypto.randomUUID(),
            ...input,
            createdAt: new Date().toISOString(),
        };
    }

    async removeConnection(
        connectionId: string,
    ): Promise<void> {
        console.log("Disconnected:", connectionId);
    }
}