# Warbler Framework — Production Implementation Prompt

## Target Package

Implement only:

```text
@warblerjs/websocket
```

The following packages already exist and must be treated as stable dependencies:

```text
@warblerjs/core
@warblerjs/config
@warblerjs/transport
@warblerjs/http
```

Do not implement TCP, UDP, MCP, WebRTC, Compiler, Runtime, View, CLI, Redis, or Mail in this task.

Do not modify another package unless a real compile-time incompatibility blocks the WebSocket implementation.

---

# Mission

Build a production-grade, Bun-native WebSocket transport package for Warbler.

The package must use Bun's native server-side WebSocket API directly:

```ts
Bun.serve({
  fetch(request, server) {
    const upgraded = server.upgrade(request, {
      data: connectionData,
    });

    return upgraded
      ? undefined
      : new Response(
          "WebSocket upgrade failed.",
          { status: 400 },
        );
  },

  websocket: {
    open(socket) {},
    message(socket, message) {},
    drain(socket) {},
    close(socket, code, reason) {},
    error(socket, error) {},
  },
});
```

The package must preserve Bun's native performance characteristics.

Do not build a custom socket server.

Do not replace Bun's:

```text
server.upgrade()
socket.send()
socket.subscribe()
socket.unsubscribe()
socket.publish()
server.publish()
socket.cork()
drain()
```

Use the native APIs directly.

Official reference:

```text
https://bun.com/docs/runtime/http/websockets
```

---

# Architecture

Warbler WebSocket flow:

```text
Socket Graph
     ↓
Socket Controller
     ↓
Compiled event table
     ↓
Bun WebSocket handlers
     ↓
Service
     ↓
Repository
```

Application example:

```ts
import {
  Graph,
  Transport,
} from "@warblerjs/core";

import ChatSocketController from "./chat.socket-controller";
import ChatService from "./chat.service";
import ChatRepository from "./chat.repository";

@Graph({
  prefix: "/chat",
  transport: Transport.WEBSOCKET,

  controllers: [
    ChatSocketController,
  ],

  providers: [
    ChatService,
    ChatRepository,
  ],
})
export default class ChatSocketGraph {}
```

HTTP remains the default Graph transport.

WebSocket Graphs must explicitly use:

```ts
transport: Transport.WEBSOCKET
```

The Graph uses only:

```ts
prefix
```

Do not introduce:

```text
namespace
socketPath
channelPrefix
```

The WebSocket adapter interprets the Graph prefix as the upgrade endpoint.

---

# Package Responsibilities

The package owns:

* WebSocket controller metadata
* Socket lifecycle decorators
* Event subscription decorators
* Upgrade handling contracts
* Per-socket contextual data
* Socket message envelopes
* Socket context
* Native Bun WebSocket adapter
* Native Pub/Sub integration
* Backpressure handling
* Drain handling
* Payload limits
* Compression configuration
* Idle timeout configuration
* Connection limits
* Authentication during upgrade
* Origin validation
* Protocol validation
* Guard execution
* Validator execution
* Error boundaries
* Safe close behavior
* Metrics contracts
* Compiled WebSocket IR contracts
* Tests
* Documentation

The package does not own:

* Source-file discovery
* TypeScript AST analysis
* Global runtime startup
* Binary artifact encoding
* OpenAPI
* HTTP controller routing
* Database logic
* Application-specific authentication

---

# Required Folder Structure

```text
packages/websocket/
├── package.json
├── tsconfig.json
├── README.md
│
├── src/
│   ├── controller/
│   │   ├── socket-controller.decorator.ts
│   │   ├── socket-controller.metadata.ts
│   │   ├── socket-controller.types.ts
│   │   └── index.ts
│   │
│   ├── events/
│   │   ├── socket-event.decorator.ts
│   │   ├── socket-event.metadata.ts
│   │   ├── socket-event.types.ts
│   │   ├── on-open.decorator.ts
│   │   ├── on-message.decorator.ts
│   │   ├── on-close.decorator.ts
│   │   ├── on-error.decorator.ts
│   │   ├── on-drain.decorator.ts
│   │   ├── subscribe.decorator.ts
│   │   └── index.ts
│   │
│   ├── message/
│   │   ├── socket-message.ts
│   │   ├── socket-message-envelope.ts
│   │   ├── socket-outgoing-message.ts
│   │   ├── decode-socket-message.ts
│   │   ├── encode-socket-message.ts
│   │   ├── socket-message-format.ts
│   │   └── index.ts
│   │
│   ├── context/
│   │   ├── socket-context.ts
│   │   ├── socket-connection.ts
│   │   ├── socket-user.ts
│   │   ├── socket-logger.ts
│   │   ├── create-socket-context.ts
│   │   └── index.ts
│   │
│   ├── upgrade/
│   │   ├── socket-upgrade-handler.ts
│   │   ├── socket-upgrade-context.ts
│   │   ├── socket-upgrade-result.ts
│   │   ├── validate-upgrade-request.ts
│   │   ├── validate-origin.ts
│   │   ├── validate-subprotocol.ts
│   │   ├── create-connection-data.ts
│   │   └── index.ts
│   │
│   ├── guards/
│   │   ├── socket-guard.ts
│   │   ├── execute-socket-guards.ts
│   │   └── index.ts
│   │
│   ├── validation/
│   │   ├── socket-validator.ts
│   │   ├── socket-validation-result.ts
│   │   ├── validate-socket-message.ts
│   │   └── index.ts
│   │
│   ├── pubsub/
│   │   ├── socket-topic.ts
│   │   ├── validate-topic.ts
│   │   ├── socket-publisher.ts
│   │   ├── socket-subscription.ts
│   │   └── index.ts
│   │
│   ├── backpressure/
│   │   ├── socket-send-result.ts
│   │   ├── socket-backpressure-policy.ts
│   │   ├── interpret-send-result.ts
│   │   ├── handle-drain.ts
│   │   └── index.ts
│   │
│   ├── config/
│   │   ├── websocket-config.types.ts
│   │   ├── normalized-websocket-config.ts
│   │   ├── validate-websocket-config.ts
│   │   ├── normalize-websocket-config.ts
│   │   └── index.ts
│   │
│   ├── native/
│   │   ├── bun-websocket-data.ts
│   │   ├── bun-websocket-handler.ts
│   │   ├── bun-websocket-server.ts
│   │   ├── bun-websocket-adapter.ts
│   │   ├── bun-websocket.types.ts
│   │   └── index.ts
│   │
│   ├── compiled/
│   │   ├── compiled-socket-graph.ts
│   │   ├── compiled-socket-controller.ts
│   │   ├── compiled-socket-event.ts
│   │   ├── compiled-socket-event-table.ts
│   │   ├── socket-event-flags.ts
│   │   ├── create-socket-dispatcher.ts
│   │   └── index.ts
│   │
│   ├── server/
│   │   ├── websocket-server-owner.ts
│   │   ├── websocket-server.types.ts
│   │   ├── websocket-server-state.ts
│   │   ├── create-websocket-server-owner.ts
│   │   └── index.ts
│   │
│   ├── errors/
│   │   ├── websocket-error.ts
│   │   ├── websocket-upgrade.error.ts
│   │   ├── websocket-origin.error.ts
│   │   ├── websocket-protocol.error.ts
│   │   ├── websocket-message.error.ts
│   │   ├── websocket-payload.error.ts
│   │   ├── websocket-validation.error.ts
│   │   ├── websocket-backpressure.error.ts
│   │   ├── websocket-state.error.ts
│   │   └── index.ts
│   │
│   ├── internal/
│   │   ├── metadata-keys.ts
│   │   ├── normalize-prefix.ts
│   │   ├── safe-close-reason.ts
│   │   └── index.ts
│   │
│   └── index.ts
│
└── tests/
    ├── socket-controller.test.ts
    ├── socket-events.test.ts
    ├── subscribe.test.ts
    ├── upgrade.test.ts
    ├── origin-validation.test.ts
    ├── protocol-validation.test.ts
    ├── message-codec.test.ts
    ├── guards.test.ts
    ├── validation.test.ts
    ├── pubsub.test.ts
    ├── backpressure.test.ts
    ├── drain.test.ts
    ├── config.test.ts
    ├── native-adapter.test.ts
    ├── server-owner.test.ts
    └── public-api.test.ts
```

Adapt the structure only when a simpler structure gives the same strong package boundaries.

Do not create empty or placeholder files merely to match this tree.

---

# Dependencies

The package may depend only on:

```text
@warblerjs/core
@warblerjs/config
@warblerjs/transport
```

Integration with `@warblerjs/http` must be optional.

Do not force `@warblerjs/http` as a runtime dependency.

Support both:

```text
shared HTTP server upgrade
dedicated Bun WebSocket server
```

No third-party WebSocket library.

Do not install:

```text
ws
socket.io
uWebSockets.js
engine.io
SockJS
```

Use Bun directly.

---

# Public API

Required public API:

```ts
import {
  SocketController,
  OnOpen,
  Subscribe,
  OnMessage,
  OnDrain,
  OnClose,
  OnError,

  type SocketContext,
  type SocketMessage,
  type SocketOutgoingMessage,
  type SocketGuard,
} from "@warblerjs/websocket";
```

Controller example:

```ts
import { inject } from "@warblerjs/core";

import {
  SocketController,
  OnOpen,
  Subscribe,
  OnMessage,
  OnDrain,
  OnClose,
  OnError,
  type SocketContext,
  type SocketMessage,
} from "@warblerjs/websocket";

import ChatService from "./chat.service";

@SocketController()
export default class ChatSocketController {
  private readonly chatService =
    inject(ChatService);

  @OnOpen()
  connected(
    context: SocketContext,
  ): void {
    context.send({
      event: "connection.ready",
      data: {
        connectionId:
          context.connection.id,
      },
    });
  }

  @Subscribe("room.join")
  async joinRoom(
    message: SocketMessage<{
      readonly roomId: string;
    }>,
    context: SocketContext,
  ): Promise<void> {
    const allowed =
      await this.chatService.canJoinRoom(
        context.user,
        message.data.roomId,
      );

    if (!allowed) {
      context.send({
        event: "room.join.denied",
        data: {
          roomId: message.data.roomId,
        },
      });

      return;
    }

    context.join(
      message.data.roomId,
    );
  }

  @Subscribe("chat.message")
  async sendMessage(
    message: SocketMessage<{
      readonly roomId: string;
      readonly content: string;
    }>,
    context: SocketContext,
  ): Promise<void> {
    const saved =
      await this.chatService.createMessage({
        userId: context.user?.id,
        roomId: message.data.roomId,
        content: message.data.content,
      });

    context.publish(
      message.data.roomId,
      {
        event:
          "chat.message.created",
        data: saved,
      },
    );
  }

  @OnMessage()
  unsupported(
    message: SocketMessage<unknown>,
    context: SocketContext,
  ): void {
    context.send({
      event:
        "socket.unsupported-event",
      data: {
        receivedEvent:
          message.event,
      },
    });
  }

  @OnDrain()
  writable(
    context: SocketContext,
  ): void {
    this.chatService.resumePendingWrites(
      context.connection.id,
    );
  }

  @OnClose()
  disconnected(
    context: SocketContext,
    code: number,
    reason: string,
  ): void {
    this.chatService.disconnect(
      context.connection.id,
      code,
      reason,
    );
  }

  @OnError()
  error(
    error: unknown,
    context: SocketContext,
  ): void {
    context.log.error(error);
  }
}
```

---

# Decorators

Support:

```ts
@SocketController()
```

Lifecycle decorators:

```ts
@OnOpen()
@OnMessage()
@OnDrain()
@OnClose()
@OnError()
```

Application event decorator:

```ts
@Subscribe("chat.message")
```

`@Subscribe()` options:

```ts
export interface SocketSubscribeOptions<
  TInput = unknown,
> {
  readonly guards?:
    readonly SocketGuard<TInput>[];

  readonly validator?:
    SocketValidator<TInput>;

  readonly rateLimit?: {
    readonly limit: number;
    readonly windowMs: number;
  };

  readonly binary?: boolean;

  readonly compression?: boolean;

  readonly timeoutMs?: number;
}
```

Decorators store immutable metadata only.

Do not execute application code during decoration.

Do not register global mutable controller instances.

---

# Guards

Guards are functions, similar to Angular functional guards.

Generic Core contract:

```ts
export type Guard<TInput = unknown> = (
  input: TInput,
) => boolean | Promise<boolean>;
```

WebSocket alias:

```ts
export type SocketGuard<
  TData = unknown,
  TUser = unknown,
> = Guard<
  SocketGuardInput<TData, TUser>
>;
```

Suggested input:

```ts
export interface SocketGuardInput<
  TData = unknown,
  TUser = unknown,
> {
  readonly message:
    SocketMessage<TData>;

  readonly context:
    SocketContext<TUser>;
}
```

Example:

```ts
export const authenticatedSocketGuard:
  SocketGuard = ({ context }): boolean => {
    return context.user !== undefined;
  };
```

DI must work:

```ts
export const roomGuard:
  SocketGuard<RoomInput> = async ({
    message,
    context,
  }): Promise<boolean> => {
    const permissions =
      inject(RoomPermissionService);

    return permissions.canJoin(
      context.user,
      message.data.roomId,
    );
  };
```

Guard result is only:

```text
true
false
Promise<boolean>
```

A Guard must not return:

```text
Response
redirect
close frame
error object
```

The generated WebSocket pipeline decides the failure behavior.

Do not force `await` for synchronous guards.

Preserve synchronous execution when the Guard returns a boolean.

---

# Upgrade Flow

A WebSocket connection starts as an HTTP upgrade request.

Required flow:

```text
Incoming HTTP request
        ↓
Match compiled WebSocket Graph prefix
        ↓
Validate method and upgrade headers
        ↓
Validate Host
        ↓
Validate Origin
        ↓
Validate optional subprotocol
        ↓
Authenticate connection
        ↓
Apply connection-rate limits
        ↓
Create immutable socket data
        ↓
server.upgrade(request, { data })
        ↓
Bun open callback
```

Use:

```ts
server.upgrade(request, {
  headers,
  data,
});
```

If upgrade succeeds, return:

```ts
undefined
```

If it fails, return a safe HTTP response.

Do not call Controller lifecycle methods before the upgrade succeeds.

---

# Per-Socket Data

Use Bun's native `ws.data`.

Create the data during `server.upgrade()`.

Example:

```ts
export interface WarblerSocketData<
  TUser = unknown,
> {
  readonly connectionId: string;
  readonly graphId: number;
  readonly controllerId: number;
  readonly connectedAt: number;
  readonly user?: TUser;
  readonly metadata:
    Readonly<Record<string, unknown>>;
}
```

Only store compact connection-specific data.

Do not store:

* Entire request bodies
* Raw secrets
* Large user records
* Service instances
* Controller instances
* Full dependency containers
* Mutable request objects

Prefer stable IDs and small immutable data.

The socket data type must be explicit in Bun's handler configuration.

---

# Authentication

Authentication happens during upgrade.

Possible sources:

* Secure cookie
* Authorization header
* Query token only when explicitly allowed
* Signed short-lived connection token
* Application-provided authentication hook

Default rules:

* Do not log credentials.
* Do not store raw passwords or long-lived secrets in `ws.data`.
* Reject malformed credentials.
* Reject expired tokens.
* Do not reveal exact authentication failure details.
* Avoid query-string tokens by default because URLs may be logged.
* Require TLS in production for credentials.
* Keep authentication hooks transport-independent where possible.

Authentication failure response:

```text
401 Unauthorized
```

or:

```text
403 Forbidden
```

depending on the configured policy.

Do not upgrade an unauthenticated request when authentication is required.

---

# Origin Security

WebSocket upgrades are vulnerable to cross-site WebSocket hijacking when cookies authenticate connections.

Validate the `Origin` header when browser connections are expected.

Configuration example:

```ts
export default {
  security: {
    origins: {
      required: true,

      allowed: [
        "https://example.com",
        "https://admin.example.com",
      ],
    },
  },
} as const;
```

Rules:

* Normalize origins strictly.
* Require exact origin matching by default.
* Do not use unsafe substring matching.
* Do not accept `example.com.attacker.test`.
* Do not trust an absent Origin automatically when policy requires it.
* Allow non-browser clients only through explicit policy.
* Do not reflect arbitrary origins.
* Support development origins explicitly.
* Validate scheme, hostname, and port.
* Reject malformed origin values.

Origin checks occur before `server.upgrade()`.

---

# Host Security

Validate the Host header through the same trusted host policy used by Warbler HTTP where possible.

Reject malformed or unexpected hosts.

Do not trust forwarded host headers unless trusted proxy configuration explicitly enables them.

---

# Subprotocol Negotiation

Support explicit allowed subprotocols.

Example:

```ts
export default {
  protocols: {
    allowed: [
      "warbler.json.v1",
      "warbler.binary.v1",
    ],

    required: false,
  },
} as const;
```

Rules:

* Parse the requested protocol list safely.
* Select only a configured protocol.
* Reject unsupported mandatory protocols.
* Never reflect arbitrary protocol strings.
* Add the selected protocol through upgrade response headers.
* Do not use subprotocol values as authorization by themselves.

---

# Message Envelope

Default JSON event envelope:

```ts
export interface SocketMessage<
  TData = unknown,
> {
  readonly id?: string;
  readonly event: string;
  readonly data: TData;
}
```

Outgoing:

```ts
export interface SocketOutgoingMessage<
  TData = unknown,
> {
  readonly id?: string;
  readonly event: string;
  readonly data: TData;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}
```

Example incoming:

```json
{
  "id": "request-100",
  "event": "chat.message",
  "data": {
    "roomId": "general",
    "content": "Hello"
  }
}
```

Example outgoing:

```json
{
  "id": "request-100",
  "event": "chat.message.created",
  "data": {
    "messageId": "msg-1"
  }
}
```

---

# Message Formats

Support:

```text
text
JSON
binary
```

Default format:

```text
JSON
```

Bun message callbacks may receive:

```text
string
ArrayBuffer
Uint8Array
```

Do not convert binary messages to strings unless the compiled event requires text.

Do not copy `Uint8Array` or `ArrayBuffer` unnecessarily.

Do not JSON-parse binary events.

Do not call `String(message)` before knowing the event format.

---

# Strict JSON Parsing

For JSON events:

* Enforce `maxPayloadLength` at Bun level.
* Reject malformed JSON.
* Require an object envelope.
* Reject arrays as root envelope unless explicitly supported.
* Require a non-empty event string.
* Limit event-name length.
* Limit message ID length.
* Validate data using the route's compiled validator.
* Reject prototype-pollution keys where relevant.
* Do not merge untrusted objects into framework objects.
* Do not deep-clone parsed messages.
* Do not silently ignore invalid fields in strict mode.

Malformed message failure must not crash the connection handler.

Return a safe framework error event or close according to policy.

---

# Event Dispatch

The compiler will eventually generate an optimized event table.

The WebSocket package must define stable compiled contracts.

Conceptual table:

```ts
export interface CompiledSocketEvent {
  readonly eventId: number;
  readonly controllerId: number;
  readonly handlerId: number;
  readonly flags: number;
  readonly guardStart: number;
  readonly guardCount: number;
  readonly validatorId: number;
  readonly timeoutMs: number;
}
```

Event lookup must be O(1) or approximately O(1).

Use a precomputed:

```ts
Map<string, CompiledSocketEvent>
```

or generated direct object lookup at startup.

Do not:

* Scan all controller methods for every message
* Scan all event records linearly
* Read decorator metadata for every message
* Resolve handler names dynamically for every message
* Rebuild dispatch tables per connection

The Compiler owns source analysis and event-table generation.

The WebSocket package owns the contracts and execution mechanism.

---

# Event String Table

Support a compiler-owned String Table.

Example:

```text
0 → chat.message
1 → ChatSocketController
2 → sendMessage
3 → room.join
```

Compiled records store numeric IDs.

String interning occurs only during compilation.

Do not construct or deduplicate String Tables in the message callback.

The runtime may resolve the required strings once at startup.

---

# Event Flags

Use compact flags for frequently checked policies.

```ts
export const SocketEventFlag = {
  BINARY: 1 << 0,
  VALIDATION_ENABLED: 1 << 1,
  GUARDS_ENABLED: 1 << 2,
  COMPRESS_RESPONSE: 1 << 3,
  RATE_LIMITED: 1 << 4,
  AUTH_REQUIRED: 1 << 5,
} as const;
```

Do not inspect nested decorator options repeatedly per message.

---

# Generated Event Pipeline

Required order:

```text
Receive Bun message
        ↓
Check message representation
        ↓
Decode envelope
        ↓
Lookup compiled event
        ↓
Payload validation
        ↓
Rate-limit check when active
        ↓
Guards
        ↓
Controller method
        ↓
Encode outgoing messages
        ↓
Native Bun send/publish
```

Unknown events go to:

```ts
@OnMessage()
```

when defined.

If no fallback exists, return a safe unsupported-event message or apply configured policy.

Do not throw an unhandled error for an unknown event.

---

# Socket Context

Suggested contract:

```ts
export interface SocketContext<
  TUser = unknown,
> {
  readonly connection: {
    readonly id: string;
    readonly connectedAt: number;
    readonly remoteAddress?: string;
  };

  readonly user?: TUser;

  readonly subscriptions:
    readonly string[];

  send<TData>(
    message:
      SocketOutgoingMessage<TData>,

    options?: {
      readonly compress?: boolean;
    },
  ): SocketSendResult;

  publish<TData>(
    topic: string,
    message:
      SocketOutgoingMessage<TData>,

    options?: {
      readonly compress?: boolean;
      readonly includeSelf?: boolean;
    },
  ): SocketSendResult;

  join(topic: string): boolean;

  leave(topic: string): boolean;

  isJoined(topic: string): boolean;

  close(
    code?: number,
    reason?: string,
  ): void;

  cork<T>(
    callback: () => T,
  ): T;

  readonly log: SocketLogger;
}
```

Do not expose unrestricted mutable Bun socket state unless through an explicitly named advanced native accessor.

Avoid wrapping every native operation in asynchronous functions.

---

# Bun Native Pub/Sub

Use:

```ts
socket.subscribe(topic)
socket.unsubscribe(topic)
socket.publish(topic, message)
server.publish(topic, message)
server.subscriberCount(topic)
```

Do not maintain a duplicate JavaScript room registry for ordinary local-process Pub/Sub.

Do not create:

```ts
Map<string, Set<Socket>>
```

when Bun's native subscriptions satisfy the requirement.

A separate distributed Pub/Sub adapter may be added later for multi-process or multi-server broadcasting.

Do not mix distributed Pub/Sub into this package now.

---

# Topic Security

Validate topic names.

Rules:

* Limit topic length.
* Reject empty topics.
* Reject control characters.
* Normalize only when explicitly defined.
* Do not allow arbitrary internal framework topic prefixes.
* Support reserved Warbler topic namespaces.
* Do not use user input directly as a topic without validation.
* Prevent tenant-to-tenant topic access through authorization checks.
* Do not expose subscription lists containing sensitive internal topics.

---

# Backpressure

Bun's native `send()` returns:

```text
-1  → message queued, backpressure active
0   → dropped or connection unavailable
1+  → bytes sent
```

Create a typed result:

```ts
export type SocketSendResult =
  | {
      readonly status: "sent";
      readonly bytes: number;
    }
  | {
      readonly status:
        "backpressure";
    }
  | {
      readonly status: "dropped";
    };
```

Interpret the native return value without hiding it.

Do not report `-1` as a successful immediate send.

Do not retry continuously in a loop.

Do not busy-wait.

Do not create polling timers.

Use Bun's `drain()` callback to resume queued application work.

---

# Backpressure Configuration

Support:

```ts
export default {
  backpressure: {
    limit: "1mb",
    closeOnLimit: true,
    strategy: "reject-new",
  },
} as const;
```

Normalized:

```ts
export interface NormalizedBackpressureConfig {
  readonly limitBytes: number;
  readonly closeOnLimit: boolean;
  readonly strategy:
    | "reject-new"
    | "close"
    | "application";
}
```

Map to Bun:

```ts
backpressureLimit
closeOnBackpressureLimit
```

Invalid limits must throw.

Do not silently disable limits.

---

# Drain

Implement Bun's native:

```ts
drain(socket)
```

The package must expose:

```ts
@OnDrain()
```

The drain lifecycle event is invoked when the socket becomes writable again after backpressure.

Do not invoke drain handlers on ordinary successful writes.

Do not create fake drain events.

Do not poll buffered state.

---

# Cork

Use:

```ts
socket.cork(() => {
  socket.send(messageA);
  socket.send(messageB);
});
```

when sending several related messages in one lifecycle callback.

Expose:

```ts
context.cork(() => {
  context.send(...);
  context.send(...);
});
```

Do not force cork for every message.

Do not create extra closures in message hot paths unless multiple writes justify it.

---

# Compression

Bun supports:

```ts
perMessageDeflate
```

and per-message compression flags.

Compression must be disabled by default unless the application explicitly enables it.

Reason:

* Compression consumes CPU.
* Small messages may become slower.
* Sensitive compressed messages may introduce side-channel concerns when attacker-controlled and secret data share a compression context.

Configuration:

```ts
export default {
  compression: {
    enabled: false,
    threshold: "4kb",
  },
} as const;
```

Do not compress every message blindly.

Compile event-level compression flags.

---

# Timeouts and Limits

Support Bun-native:

```text
idleTimeout
maxPayloadLength
backpressureLimit
closeOnBackpressureLimit
sendPings
publishToSelf
```

Suggested secure initial defaults:

```ts
export default {
  idleTimeout: "60s",
  maxPayloadLength: "1mb",

  backpressure: {
    limit: "1mb",
    closeOnLimit: true,
  },

  sendPings: true,
  publishToSelf: false,
} as const;
```

All strings must be strictly parsed through `@warblerjs/config`.

Reject:

```text
NaN
Infinity
0 where invalid
negative values
unsafe integers
invalid units
null
empty strings
unknown enum values
```

Never silently fall back when a provided value is invalid.

---

# Connection Limits

Support:

```ts
export default {
  limits: {
    totalConnections: 10000,
    connectionsPerIp: 20,
    subscriptionsPerConnection: 100,
    eventsPerSecond: 50,
    eventNameLength: 128,
    messageIdLength: 128,
  },
} as const;
```

Do not allocate a timer per connection.

Rate limiting must avoid event-loop-heavy designs.

Prefer:

* Compact counters
* Fixed or sliding windows with shared clock buckets
* Cleanup during natural activity
* Bounded maps
* External adapters for distributed limits

Do not create one `setInterval()` per socket.

---

# Ping and Pong

Bun can send protocol pings through its native configuration.

Use native `sendPings` behavior.

Do not implement application-level heartbeat messages automatically.

Application heartbeats must be explicit and must not create a hidden interval per connection.

If heartbeat support is added:

* Use one shared scheduler.
* Respect connection close.
* Stop all tracking on disconnect.
* Bound memory.
* Do not duplicate Bun's protocol-level ping behavior without reason.

---

# Close Behavior

Validate close codes and reasons.

Rules:

* Reason must respect protocol byte limits.
* Remove control characters.
* Do not expose stack traces.
* Do not expose tokens or internal identifiers.
* Use standard close codes where appropriate.
* Use application close codes only within a documented range.
* Never place large error payloads in close reasons.

Example safe failure events may be sent before closing when the connection remains writable.

---

# Error Handling

Errors must never escape Bun callbacks unhandled.

Each native lifecycle callback must have a safe boundary.

```text
open
message
drain
close
error
```

Typed errors only for public package behavior.

Error policy examples:

```ts
export interface SocketErrorPolicy {
  readonly exposeMessages: boolean;
  readonly sendErrorEvent: boolean;
  readonly closeOnUnhandledError: boolean;
  readonly closeCode: number;
}
```

Production defaults:

* Do not expose stack traces.
* Do not expose database details.
* Do not expose validation internals.
* Log safe contextual metadata.
* Close corrupted or unsafe connections.
* Keep recoverable event failures connection-local.

---

# Event Loop and Performance

This requirement is mandatory.

Do not block Bun's event loop.

Do not:

* Perform synchronous filesystem calls in WebSocket handlers
* Poll
* Busy-wait
* Deep-clone messages
* JSON stringify and parse the same message repeatedly
* Create a Promise for every synchronous handler
* Mark every callback `async`
* Use linear event dispatch
* Rebuild validators per message
* Rebuild Guard arrays per message
* Resolve controller metadata per message
* Create a new dependency container per message
* Create a new controller per message
* Create a timer per connection
* Retry sends in an immediate loop
* Use `Bun.deepEquals()` in message callbacks
* Log every message by default

Use:

* Precomputed event tables
* Prebound handlers
* Numeric IDs
* Event flags
* Native Pub/Sub
* Native backpressure
* Native drain
* Shared immutable configuration
* Small socket data
* Sync handlers that remain synchronous
* `boolean | Promise<boolean>` Guards
* Direct `for` loops in hot paths

---

# MaybePromise Handling

Do not force all handlers to return Promise.

Lifecycle handlers may return:

```ts
void | Promise<void>
```

Event handlers may return:

```ts
void
SocketOutgoingMessage
Promise<void>
Promise<SocketOutgoingMessage>
```

Generated dispatch must preserve synchronous behavior.

Do not do:

```ts
await handler(...)
```

unconditionally when the result is synchronous.

Do not use:

```ts
Promise.resolve(handler(...))
```

for every message.

Use a narrow thenable check or generated sync/async specialization.

The Compiler may mark handlers with an async flag.

---

# Configuration Discovery

Runtime config convention:

```text
playground/src/config/runtime.config.ts
```

Transport config convention:

```text
playground/src/config/transports/ws.config.ts
```

Rules:

1. Load `runtime.config.ts` first.
2. Check:

```ts
transports.websocket.enabled
```

3. When disabled:

```text
Do not import @warblerjs/websocket
Do not load ws.config.ts
Do not validate ws.config.ts
Do not register WebSocket Graphs
Do not start a listener
```

4. When enabled:

```text
Confirm ws.config.ts exists
Load it once
Strictly validate it
Normalize it
Freeze it
Start the adapter
```

The WebSocket package exports config validation and normalization.

Filesystem discovery remains the responsibility of `@warblerjs/config`, Compiler, or Runtime orchestration.

---

# Suggested ws.config.ts

```ts
export default {
  mode: "shared-http",

  security: {
    origins: {
      required: true,
      allowed: [
        "http://localhost:3000",
      ],
    },

    authentication: {
      required: true,
    },

    protocols: {
      allowed: [
        "warbler.json.v1",
      ],
      required: false,
    },
  },

  messages: {
    format: "json",
    maxPayloadLength: "1mb",
    maxEventNameLength: 128,
    maxMessageIdLength: 128,
    unknownEvent: "send-error",
  },

  compression: {
    enabled: false,
    threshold: "4kb",
  },

  timeouts: {
    idle: "60s",
    handler: "30s",
  },

  backpressure: {
    limit: "1mb",
    closeOnLimit: true,
    strategy: "reject-new",
  },

  limits: {
    totalConnections: 10000,
    connectionsPerIp: 20,
    subscriptionsPerConnection: 100,
    eventsPerSecond: 50,
  },

  bun: {
    sendPings: true,
    publishToSelf: false,
  },
} as const;
```

---

# Shared HTTP Mode

Support:

```ts
mode: "shared-http"
```

The existing Bun HTTP server handles WebSocket upgrades.

The WebSocket package provides upgrade matching and Bun WebSocket handler options.

Do not start a second server.

Upgrade requests match the Graph prefix:

```text
/chat
```

Normal HTTP requests remain handled by `@warblerjs/http`.

---

# Dedicated Mode

Support:

```ts
mode: "dedicated"
```

Use the port from:

```text
runtime.config.ts
```

Example:

```ts
transports: {
  websocket: {
    enabled: true,
    mode: "dedicated",
    port: 8443,
  },
}
```

Create a dedicated:

```ts
Bun.serve({
  port,
  fetch: upgradeHandler,
  websocket: websocketHandlers,
});
```

No duplicated event-dispatch implementation between shared and dedicated modes.

---

# Transport Adapter

Implement `TransportAdapter` from:

```text
@warblerjs/transport
```

Conceptual contract:

```ts
export interface WebSocketTransportAdapter
  extends TransportAdapter<
    typeof Transport.WEBSOCKET,
    NormalizedWebSocketConfig,
    CompiledSocketGraph,
    BunWebSocketServerHandle
  > {}
```

Start must:

* Receive normalized config
* Receive compiled WebSocket Graphs
* Build event dispatch tables
* Build upgrade path lookup
* Create or attach Bun handlers
* Return a typed transport handle

Stop must be idempotent and safe.

---

# Server Ownership

Implement explicit lifecycle:

```text
CREATED
STARTING
RUNNING
STOPPING
STOPPED
```

Requirements:

* No global server singleton
* Start once
* Stop safely
* Repeated stop is safe
* Invalid transitions throw typed errors
* Native server handle retained
* Active sockets optionally closed during shutdown
* Shutdown reason sanitized
* Test factory injectable internally

---

# Metrics

Expose or integrate Bun-native metrics:

```text
server.pendingWebSockets
server.subscriberCount(topic)
```

Do not maintain duplicate counters when Bun already provides the value.

Application metrics may additionally track:

* Upgrade attempts
* Upgrade failures
* Authentication failures
* Origin rejections
* Invalid messages
* Guard rejections
* Backpressure events
* Dropped sends
* Handler errors

Metrics must be optional and low-overhead.

Do not create labels from arbitrary user-provided values.

---

# Logging

Logging must be configurable.

Never log by default:

* Full message bodies
* Authorization headers
* Cookies
* Query tokens
* User secrets
* Binary payloads
* Private topics

Safe metadata may include:

* Connection ID
* Event ID
* Graph ID
* Handler ID
* Error code
* Payload byte length
* Close code

Avoid synchronous console output in high-volume message paths.

---

# Compiler Contracts

The package must define stable contracts for later Compiler integration.

The Compiler will discover:

```text
Socket Graphs
Socket Controllers
Lifecycle methods
Subscribe methods
Guards
Validators
Policies
Handler sync/async behavior
Message format
Compression flags
```

It will generate:

```text
Event String Table
Controller IDs
Handler IDs
Event IDs
Event flags
Guard ranges
Validator IDs
Upgrade prefix table
```

The WebSocket package must not implement TypeScript source analysis.

---

# No Runtime Reflection

Do not use:

```text
reflect-metadata
method-name scanning per message
decorator scanning per connection
dynamic property enumeration per event
```

Decorator metadata may be consumed once during development bootstrap until the Compiler is complete.

Production must execute compiled tables.

---

# Testing

Use only:

```text
bun:test
```

Tests must include:

## Metadata

* `SocketController`
* `OnOpen`
* `Subscribe`
* `OnMessage`
* `OnDrain`
* `OnClose`
* `OnError`
* Immutable metadata
* Duplicate lifecycle method rejection
* Duplicate event-name rejection

## Upgrade

* Successful upgrade
* Failed upgrade
* Correct per-socket data
* Authentication required
* Authentication rejection
* Origin allowed
* Origin rejected
* Missing required Origin
* Exact origin matching
* Host validation
* Protocol negotiation
* Unsupported protocol

## Messages

* Valid JSON envelope
* Invalid JSON
* Missing event
* Oversized event name
* Oversized message ID
* String payload
* ArrayBuffer payload
* Uint8Array payload
* Unknown event fallback
* No unknown-event fallback
* Sync handler
* Async handler

## Guards

* Sync true
* Sync false
* Async true
* Async false
* Guard order
* Stop after first false
* Controller not executed on rejection
* DI inside functional Guard

## Validation

* Valid payload
* Invalid payload
* Validator not recreated per message
* Validation before Controller execution

## Pub/Sub

* Subscribe
* Unsubscribe
* Publish excluding self
* Server publish including all
* Invalid topic
* Subscription limit

## Backpressure

* Positive send result
* Zero send result
* Negative send result
* Drain invocation
* No busy retry
* Close-on-limit mapping
* Backpressure configuration

## Security

* Credentials not logged
* Query-token disabled by default
* Safe close reasons
* No stack-trace exposure
* Payload limits
* Connection limits
* Rate limit behavior
* Reserved topic protection

## Lifecycle

* Start
* Stop
* Repeated stop
* Invalid transition
* Shared HTTP mode
* Dedicated mode
* Graceful shutdown

## Public API

* Correct exports
* No internal implementation leakage
* No third-party WebSocket runtime dependency

---

# TypeScript Rules

Strict TypeScript.

Never use:

```text
any
@ts-ignore
@ts-nocheck
```

Use explicit generic types for:

```text
ws.data
SocketContext
SocketMessage
Guards
Validators
Compiled event records
```

Avoid unsafe type assertions.

Every exported symbol requires TSDoc.

No unfinished placeholders.

No TODOs.

No dead code.

---

# Package Scripts

```json
{
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

Use workspace dependencies.

---

# README Requirements

Document:

* Package purpose
* Bun-native architecture
* Graph example
* Controller example
* Lifecycle decorators
* `Subscribe`
* Functional Guards
* Message envelope
* Shared HTTP mode
* Dedicated mode
* Authentication during upgrade
* Origin protection
* Native Pub/Sub
* Backpressure semantics
* Compression
* Limits
* Configuration
* Performance rules
* What the package intentionally does not implement

Do not document unfinished behavior as complete.

---

# Completion Criteria

The package is complete only when:

1. `bun test` passes.
2. `tsc --noEmit` passes.
3. Bun native WebSocket APIs are used directly.
4. Upgrade authentication runs before `server.upgrade()`.
5. Origin validation is implemented.
6. Per-socket data uses `server.upgrade({ data })`.
7. Native Pub/Sub is used.
8. No duplicate JavaScript room registry exists for local Pub/Sub.
9. Backpressure return values are handled correctly.
10. `drain()` is supported.
11. No busy retry loop exists.
12. No timer exists per connection.
13. Sync handlers remain synchronous.
14. Guards return only `boolean | Promise<boolean>`.
15. Message limits cannot be silently disabled.
16. Invalid config fails explicitly.
17. Compression is opt-in.
18. Binary payloads are not converted unnecessarily.
19. Event dispatch does not scan all handlers.
20. Runtime reflection is absent from production paths.
21. Shared HTTP and dedicated modes are tested.
22. No secrets or complete payloads are logged by default.
23. Every public API has TSDoc.
24. No `any`, placeholder, or TODO remains.
25. The package is production-ready.

Do not begin the next Warbler package until every completion criterion passes.
