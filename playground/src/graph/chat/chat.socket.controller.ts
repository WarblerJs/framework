// @ts-nocheck
import {
    inject,
  } from "@warbler/core";
  
  import {
    SocketController,
    OnOpen,
    OnMessage,
    OnClose,
    OnError,
    Subscribe,
    type SocketContext,
    type SocketMessage,
  } from "@warbler/websocket";
  
  import ChatService from "./chat.service";
  
  @SocketController()
  export default class ChatSocketController {
    private readonly chatService = inject(ChatService);
  
    @OnOpen()
    async connected(context: SocketContext): Promise<void> {
      await this.chatService.connectUser({
        connectionId: context.connection.id,
        userId: context.user?.id,
      });
  
      context.send({
        event: "connection.ready",
        data: {
          connectionId: context.connection.id,
        },
      });
    }
  
    @Subscribe("room.join",{
        validator: sendMessageValidator,
        guards: [authenticatedSocketGuard],
        rateLimit: {
          limit: 20,
          window: "10s",
        },
    })
    async joinRoom(
      message: SocketMessage<{
        readonly roomId: string;
      }>,
      context: SocketContext,
    ): Promise<void> {
      await this.chatService.joinRoom({
        connectionId: context.connection.id,
        roomId: message.data.roomId,
      });
  
      context.join(message.data.roomId);
  
      context.send({
        event: "room.joined",
        data: {
          roomId: message.data.roomId,
        },
      });
    }
  
    @Subscribe("chat.message")
    async sendMessage(
      message: SocketMessage<{
        readonly roomId: string;
        readonly content: string;
      }>,
      context: SocketContext,
    ): Promise<void> {
      const savedMessage =
        await this.chatService.createMessage({
          userId: context.user?.id,
          roomId: message.data.roomId,
          content: message.data.content,
        });
  
      context.publish(message.data.roomId, {
        event: "chat.message.created",
        data: savedMessage,
      });
    }
  
    @Subscribe("typing.start")
    typingStarted(
      message: SocketMessage<{
        readonly roomId: string;
      }>,
      context: SocketContext,
    ): void {
      context.publish(
        message.data.roomId,
        {
          event: "typing.started",
          data: {
            userId: context.user?.id,
          },
        },
        {
          excludeSelf: true,
        },
      );
    }
  
    @Subscribe("typing.stop")
    typingStopped(
      message: SocketMessage<{
        readonly roomId: string;
      }>,
      context: SocketContext,
    ): void {
      context.publish(
        message.data.roomId,
        {
          event: "typing.stopped",
          data: {
            userId: context.user?.id,
          },
        },
        {
          excludeSelf: true,
        },
      );
    }
  
    @OnMessage()
    unsupportedMessage(
      message: SocketMessage<unknown>,
      context: SocketContext,
    ): void {
      context.send({
        event: "socket.unsupported-event",
        data: {
          receivedEvent: message.event,
        },
      });
    }
  
    @OnClose()
    async disconnected(
      context: SocketContext,
    ): Promise<void> {
      await this.chatService.disconnectUser(
        context.connection.id,
      );
    }
  
    @OnError()
    error(
      error: unknown,
      context: SocketContext,
    ): void {
      context.log.error(error);
  
      context.send({
        event: "socket.error",
        data: {
          message: "Unexpected socket error",
        },
      });
    }
  }