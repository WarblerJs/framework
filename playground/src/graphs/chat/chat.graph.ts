import { Graph, Transport } from "@warbler/core";
import ChatRepository from "./chat.repository";
import ChatService from "./chat.service";
import ChatSocketController from "./chat.socket-controller";

@Graph({
  prefix: "/chat",
  transport: Transport.WEBSOCKET,
  controllers: [ChatSocketController],
  providers: [ChatService, ChatRepository],
})
export default class ChatGraph {}
