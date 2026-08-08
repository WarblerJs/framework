import { inject, NotFoundError } from "@warbler/core";
import {
  OnClose,
  OnDrain,
  OnError,
  OnMessage,
  OnOpen,
  SocketController,
  Subscribe,
  type SocketContext,
  type SocketMessage,
} from "@warbler/websocket";
import { AppErrorCode } from "../../shared/errors/app-error-code";
import { chatGuard } from "./chat.guard";
import ChatService from "./chat.service";
import { type ChatMessageInput, chatMessageValidator, roomJoinValidator } from "./chat.validator";

@SocketController()
export default class ChatSocketController {
  readonly #chat = inject(ChatService);

  @OnOpen()
  open(context: SocketContext): void {
    console.log('Socket,opened')
    context.send({ event: "connection.ready", data: { connectionId: context.connection.id } });
  }

  @Subscribe("ping")
  ping(_message: SocketMessage<unknown>, context: SocketContext): void {
    context.send({ event: "pong", data: { at: Date.now() } });
  }

  /**
   * Demonstrates the unified WebSocket exception boundary: a typed throw here does not
   * kill the connection. The client receives a safe `{event:"error", data:{code,message}}`
   * envelope, the `@OnError()` handler below still fires, and the connection remains
   * usable for the next message (try `ping` right after).
   */
  @Subscribe("crash")
  crash(message: SocketMessage<{ readonly roomId?: string }>): void {
    throw new NotFoundError(AppErrorCode.ROOM_NOT_FOUND, `Room "${message.data.roomId ?? "unknown"}" does not exist.`);
  }

  @Subscribe("room.join", { validator: roomJoinValidator })
  join(message: SocketMessage<{ readonly roomId: string }>, context: SocketContext): void {
    context.join(message.data.roomId);
    context.send({ event: "room.joined", data: { roomId: message.data.roomId } });
  }

  @Subscribe("chat.message", {
    validator: chatMessageValidator,
    guards: [chatGuard],
    rateLimit: { limit: 50, windowMs: 1_000 },
  })
  message(message: SocketMessage<ChatMessageInput>, context: SocketContext): void {
    console.log('Chat.message',message.data.roomId, message.data.content)
    const saved = this.#chat.createMessage(message.data.roomId, message.data.content);
    context.publish(message.data.roomId, { event: "chat.message.created", data: saved });
  }

  @OnMessage()
  unsupported(message: SocketMessage<unknown>, context: SocketContext): void {
    context.send({ event: "socket.unsupported-event", data: { receivedEvent: message.event } });
  }

  @OnDrain()
  drain(): void {
    console.log('Socket,drain')
  }

  @OnClose()
  close(): void {
    console.log('Socket,closed')
  }

  @OnError()
  error(error: unknown, context: SocketContext): void {
    console.log('Socket,error', error)
    context.log.error(error)
  }
}
