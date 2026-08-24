import { afterEach, describe, expect, test } from "bun:test";
import type { RuntimeExecutionContext, RuntimeTransportStartInput } from "@warblerjs/transport";
import { NotFoundError, WarblerError } from "@warblerjs/core";
import { Console } from "@warblerjs/console";
import { createWebSocketRuntimeLauncher } from "../src/runtime-launcher";
import type { WebSocketConfig } from "../src/config";
import {
  SocketPublisher,
  SocketRuntimeStoppedError,
  resetSocketPublisherRuntimeForTests,
  type SocketContext,
  type SocketMessage,
} from "../src";

const runtime: RuntimeExecutionContext = {
  resolveProvider: () => undefined,
  invokeHandler: () => undefined,
};

afterEach(() => resetSocketPublisherRuntimeForTests());

function startInput(config: WebSocketConfig & { readonly port?: number; readonly host?: string }): RuntimeTransportStartInput<{ dispatch: () => void }, WebSocketConfig> {
  return Object.freeze({
    bindings: { dispatch: () => {} },
    config: config as WebSocketConfig,
    runtime,
    signal: new AbortController().signal,
  });
}

type WebSocketLauncher = ReturnType<typeof createWebSocketRuntimeLauncher>;
type WebSocketHandle = Awaited<ReturnType<WebSocketLauncher["start"]>>;

async function startJoinServer(launcher: WebSocketLauncher): Promise<Readonly<{ port: number; handle: WebSocketHandle }>> {
  const port = 39_000 + Math.floor(Math.random() * 1_000);
  const handle = await launcher.start(Object.freeze({
    bindings: {
      compiled: { events: { join: {} } },
      dispatch(event: string, message: unknown, context: unknown): void {
        if (event !== "join") return;
        const socketMessage = message as SocketMessage<{ readonly topic: string }>;
        const socketContext = context as SocketContext;
        socketContext.join(socketMessage.data.topic);
        socketContext.send({ event: "joined", data: { topic: socketMessage.data.topic } });
      },
    },
    config: { mode: "dedicated", port, host: "127.0.0.1" } as unknown as WebSocketConfig,
    runtime,
    signal: new AbortController().signal,
  }));
  return Object.freeze({ port, handle });
}

async function subscribedSocket(port: number, topic: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("connect failed")), { once: true });
  });
  const joined = nextMessage(socket);
  socket.send(JSON.stringify({ event: "join", data: { topic } }));
  expect(await joined).toEqual({ event: "joined", data: { topic } });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), { once: true });
  });
}

async function boundedStop(launcher: WebSocketLauncher, handle: WebSocketHandle): Promise<void> {
  await Promise.race([launcher.stop?.(handle, { closeActiveConnections: true }), Bun.sleep(200)]);
}

describe("createWebSocketRuntimeLauncher", () => {
  test("binds the dedicated server to the configured host, not a wildcard default", async () => {
    const launcher = createWebSocketRuntimeLauncher();
    const port = 39_000 + Math.floor(Math.random() * 1_000);
    const handle = await launcher.start(startInput({ mode: "dedicated", port, host: "127.0.0.1" }));
    try {
      expect(handle.server.hostname).toBe("127.0.0.1");
    } finally {
      await launcher.stop?.(handle, {});
    }
  });

  test("throws for a non-dedicated mode", () => {
    const launcher = createWebSocketRuntimeLauncher();
    expect(() => launcher.start(startInput({ mode: "shared-http", port: 0, host: "127.0.0.1" }))).toThrow(TypeError);
  });

  test("SocketPublisher publishes through the active runtime to every native subscriber", async () => {
    const launcher = createWebSocketRuntimeLauncher();
    const port = 39_000 + Math.floor(Math.random() * 1_000);
    const handle = await launcher.start(Object.freeze({
      bindings: {
        compiled: { events: { join: {} } },
        dispatch(event: string, message: unknown, context: unknown): void {
          if (event !== "join") return;
          const socketMessage = message as SocketMessage<{ readonly topic: string }>;
          const socketContext = context as SocketContext;
          socketContext.join(socketMessage.data.topic);
          socketContext.send({ event: "joined", data: { topic: socketMessage.data.topic } });
        },
      },
      config: { mode: "dedicated", port, host: "127.0.0.1" } as unknown as WebSocketConfig,
      runtime,
      signal: new AbortController().signal,
    }));
    try {
      const first = await subscribedSocket(port, "notifications");
      const second = await subscribedSocket(port, "notifications");
      try {
        const firstMessage = nextMessage(first);
        const secondMessage = nextMessage(second);
        const result = new SocketPublisher().publish("notifications", { event: "notify", data: { userId: 123 } });
        expect(result.status).toBe("sent");
        expect(await firstMessage).toEqual({ event: "notify", data: { userId: 123 } });
        expect(await secondMessage).toEqual({ event: "notify", data: { userId: 123 } });
      } finally {
        first.close();
        second.close();
      }
    } finally {
      await boundedStop(launcher, handle);
    }
  });

  test("production websocket logging can be disabled without disabling publishing", async () => {
    let socketLogs = 0;
    const originalSocket = Console.socket.bind(Console);
    Console.socket = ((input) => {
      socketLogs += 1;
      return originalSocket(input);
    }) as typeof Console.socket;
    const launcher = createWebSocketRuntimeLauncher();
    const port = 39_000 + Math.floor(Math.random() * 1_000);
    const handle = await launcher.start(Object.freeze({
      bindings: {
        compiled: { events: { join: {} } },
        dispatch(event: string, message: unknown, context: unknown): void {
          if (event !== "join") return;
          const socketMessage = message as SocketMessage<{ readonly topic: string }>;
          const socketContext = context as SocketContext;
          socketContext.join(socketMessage.data.topic);
          socketContext.send({ event: "joined", data: { topic: socketMessage.data.topic } });
        },
      },
      config: { mode: "dedicated", port, host: "127.0.0.1", logging: { websocket: false, errors: true } } as unknown as WebSocketConfig,
      runtime,
      signal: new AbortController().signal,
    }));
    try {
      const socket = await subscribedSocket(port, "quiet");
      try {
        const message = nextMessage(socket);
        expect(new SocketPublisher().publish("quiet", { event: "notice", data: 1 }).status).toBe("sent");
        expect(await message).toEqual({ event: "notice", data: 1 });
        expect(socketLogs).toBe(0);
      } finally {
        socket.close();
      }
    } finally {
      Console.socket = originalSocket as typeof Console.socket;
      await boundedStop(launcher, handle);
    }
  });

  test("the same SocketPublisher instance follows shutdown and restart", async () => {
    const launcher = createWebSocketRuntimeLauncher();
    const publisher = new SocketPublisher();
    const first = await startJoinServer(launcher);
    try {
      const socket = await subscribedSocket(first.port, "restart");
      const message = nextMessage(socket);
      expect(publisher.publish("restart", { event: "notice", data: 1 }).status).toBe("sent");
      expect(await message).toEqual({ event: "notice", data: 1 });
      socket.close();
    } finally {
      await boundedStop(launcher, first.handle);
    }
    expect(() => publisher.publish("restart", { event: "notice", data: 2 })).toThrow(SocketRuntimeStoppedError);

    const second = await startJoinServer(launcher);
    try {
      const socket = await subscribedSocket(second.port, "restart");
      const message = nextMessage(socket);
      expect(publisher.publish("restart", { event: "notice", data: 3 }).status).toBe("sent");
      expect(await message).toEqual({ event: "notice", data: 3 });
      socket.close();
    } finally {
      await boundedStop(launcher, second.handle);
    }
  });

  describe("unified exception boundary", () => {
    async function withServer(
      dispatch: (event: string, message: unknown, context: any) => unknown,
      body: (socket: WebSocket) => Promise<void>,
    ): Promise<void> {
      const launcher = createWebSocketRuntimeLauncher();
      const port = 39_000 + Math.floor(Math.random() * 1_000);
      const handle = await launcher.start(Object.freeze({
        bindings: {
          dispatch,
          compiled: { events: { crash: {}, ping: {}, fatal: {} } },
        },
        config: { mode: "dedicated", port, host: "127.0.0.1" } as unknown as WebSocketConfig,
        runtime,
        signal: new AbortController().signal,
      }));
      try {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener("open", () => resolve(), { once: true });
          socket.addEventListener("error", () => reject(new Error("connect failed")), { once: true });
        });
        await body(socket);
        if (socket.readyState === WebSocket.OPEN) socket.close();
      } finally {
        // `Bun.Server.stop()` can hang when the only connection was already closed via
        // `ServerWebSocket.close()` (a server-initiated close, e.g. the fatal-error path)
        // rather than through the server's own shutdown machinery — a Bun quirk unrelated
        // to this boundary's correctness (already asserted above). Bound cleanup so a test
        // never hangs on it.
        await Promise.race([launcher.stop?.(handle, { closeActiveConnections: true }), Bun.sleep(200)]);
      }
    }

    function nextMessage(socket: WebSocket): Promise<unknown> {
      return new Promise((resolve) => {
        socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), { once: true });
      });
    }

    function nextClose(socket: WebSocket): Promise<CloseEvent> {
      return new Promise((resolve) => {
        socket.addEventListener("close", (event) => resolve(event), { once: true });
      });
    }

    test("a handler throw sends a safe error envelope and keeps the connection usable", async () => {
      await withServer(
        (event, _message, context) => {
          if (event === "crash") throw new NotFoundError("USER_NOT_FOUND", "User not found");
          if (event === "ping") { context.send({ event: "pong", data: {} }); return undefined; }
          return undefined;
        },
        async (socket) => {
          socket.send(JSON.stringify({ event: "crash", data: {} }));
          const errorMessage = await nextMessage(socket) as { event: string; data: { code: string; message: string } };
          expect(errorMessage.event).toBe("error");
          expect(errorMessage.data).toEqual({ code: "USER_NOT_FOUND", message: "User not found" });

          // The connection must still be usable after a recoverable failure.
          socket.send(JSON.stringify({ event: "ping", data: {} }));
          const pong = await nextMessage(socket) as { event: string };
          expect(pong.event).toBe("pong");
        },
      );
    });

    test("a fatal WarblerError closes only that connection, with 1011", async () => {
      await withServer(
        (event) => {
          if (event === "fatal") throw new WarblerError("CONN_DEAD", 500, "Connection is no longer valid", false, true);
          return undefined;
        },
        async (socket) => {
          const closed = nextClose(socket);
          socket.send(JSON.stringify({ event: "fatal", data: {} }));
          const event = await closed;
          expect(event.code).toBe(1011);
        },
      );
    });

    test("dispatches the compiled error lifecycle with (errorPayload, context)", async () => {
      const received: unknown[] = [];
      await withServer(
        (event, message, context) => {
          if (event === "crash") throw new Error("boom");
          if (event === "error") { received.push(message); return undefined; }
          void context;
          return undefined;
        },
        async (socket) => {
          socket.send(JSON.stringify({ event: "crash", data: {} }));
          await nextMessage(socket);
          expect(received).toEqual([{ code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error" }]);
        },
      );
    });

    test("a broken @OnError() handler doesn't prevent the safe error envelope", async () => {
      await withServer(
        (event) => {
          if (event === "crash") throw new Error("boom");
          if (event === "error") throw new Error("OnError handler itself is broken");
          return undefined;
        },
        async (socket) => {
          socket.send(JSON.stringify({ event: "crash", data: {} }));
          const errorMessage = await nextMessage(socket) as { event: string };
          expect(errorMessage.event).toBe("error");
        },
      );
    });

    test("a malformed message still closes with 1008 (unchanged decode-failure behavior)", async () => {
      await withServer(
        () => undefined,
        async (socket) => {
          const closed = nextClose(socket);
          socket.send("not json");
          const event = await closed;
          expect(event.code).toBe(1008);
        },
      );
    });
  });
});
