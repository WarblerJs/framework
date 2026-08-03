// @ts-nocheck
import { Service, inject, } from "@warbler/core";
import ChatRepository from "./chat.repository";

interface ConnectUserInput {
    readonly connectionId: string;
    readonly userId?: string;
}

interface JoinRoomInput {
    readonly connectionId: string;
    readonly roomId: string;
}

interface CreateMessageInput {
    readonly userId?: string;
    readonly roomId: string;
    readonly content: string;
}

@Service()
export default class ChatService {
    private readonly chatRepository = inject(ChatRepository);

    connectUser(input: ConnectUserInput) {
        return this.chatRepository.saveConnection(input);
    }

    joinRoom(input: JoinRoomInput) {
        return this.chatRepository.addConnectionToRoom(
            input,
        );
    }

    createMessage(input: CreateMessageInput) {
        return this.chatRepository.createMessage(input);
    }

    disconnectUser(connectionId: string) {
        return this.chatRepository.removeConnection(
            connectionId,
        );
    }
}