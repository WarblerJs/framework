# @warbler/websocket

Production-oriented, Bun-native WebSocket transport contracts and execution for Warbler. It uses `server.upgrade`, `ws.data`, native send/cork/drain, and Bun Pub/Sub directly. It does not implement a socket server, source discovery, compiler analysis, distributed rooms, or application authentication.

```ts
@Graph({ prefix: "/chat", transport: Transport.WEBSOCKET, controllers: [ChatSocketController] })
class ChatGraph {}

@SocketController()
class ChatSocketController {
  @OnOpen()
  open(context: SocketContext) {
    context.send({ event: "connection.ready", data: { id: context.connection.id } });
  }

  @Subscribe("chat.message", { guards: [authenticatedSocketGuard] })
  message(message: SocketMessage<{ roomId: string }>, context: SocketContext) {
    context.publish(message.data.roomId, { event: "chat.message.created", data: message.data });
  }

  @OnDrain()
  drain(context: SocketContext) {}
}
```

Messages default to strict JSON envelopes with `event`, optional `id`, and `data`. Functional guards remain synchronous when possible. Origin, Host, subprotocol, and authentication checks happen before upgrade. Authentication is supplied as an application hook and raw credentials are never stored.

`normalizeWebSocketConfig` strictly parses payload, timeout, compression, backpressure, and connection limits. Compression is opt-in. Bun's `-1`, `0`, and positive send results become `backpressure`, `dropped`, and `sent`; retry scheduling is deliberately application-owned and resumes through `@OnDrain`.

Shared HTTP mode exposes `fetch` and `websocket` handlers for an existing server. Dedicated mode creates one `Bun.serve` listener owned by an idempotently stoppable `WebSocketServerOwner`. Native subscriptions are used without a JavaScript room registry.

## Exception boundary

A subscribed event handler, or an `@OnOpen`/`@OnDrain`/`@OnClose` lifecycle callback, throwing
— synchronously or in a rejected promise — never crashes the connection or the process. It's
normalized (`@warbler/core`'s `normalizeError`), logged, and handled one of two ways:

- **Recoverable (the default)**: the client receives a safe envelope and the connection stays
  open and usable for the next message —
  ```json
  { "event": "error", "data": { "code": "USER_NOT_FOUND", "message": "User not found" } }
  ```
- **Connection-fatal**: only when the normalized error is a `WarblerError` constructed with
  `fatal: true` — the connection closes with code `1011`, and only that connection; unrelated
  sockets are unaffected.

A declared `@OnError()` handler is also invoked, with the normalized `(error, context)` — for
logging/observability, independent of the envelope sent above:

```ts
@OnError()
error(error: unknown, context: SocketContext) {
  context.log.error(error);
}
```

A malformed message (unparseable wire format — not an application error) is unrelated to this
boundary and still closes the connection with code `1008`, unchanged.
