// @ts-nocheck
import {Graph,Transport} from "@warbler/core";
  
  import ChatSocketController from "./chat.socket-controller";
  import ChatService from "./chat.service";
  import ChatRepository from "./chat.repository";
  
  @Graph({
    prefix: "/chat",
    transport: Transport.WEB_SOCKET,

    controllers: [
      ChatSocketController,
    ],
  
    providers: [
      ChatService,
      ChatRepository,
    ],
  })
  export default class ChatSocketGraph {}