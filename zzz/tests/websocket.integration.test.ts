import { expect, test } from "bun:test";
import { startCaptured } from "./helpers";

interface CapturedSocket {
  readonly dispatch: (event: string, message: unknown, context: unknown) => unknown;
}

test("generated WebSocket dispatch invokes Subscribe handlers", async () => {
  let captured: CapturedSocket | undefined;
  const runtime = await startCaptured("websocket", (bindings) => { captured = bindings as CapturedSocket; });
  const sent: unknown[] = [];
  const joined: string[] = [];
  let closed = false;
  const context = {
    connection: { id: "socket-1", connectedAt: Date.now() },
    send: (message: unknown) => { sent.push(message); return { status: "sent", bytes: 1 }; },
    publish: () => ({ status: "sent", bytes: 1 }),
    join: (topic: string) => { joined.push(topic); return true; },
    leave: () => ({ topic: "general", subscribed: false }),
    subscriptions: () => Object.freeze([]),
    close: () => { closed = true; },
    tr: (key: string) => key === "validators.invalid_room" ? "Room is invalid." : key,
    log: { error: () => {} },
  };
  try {
    await captured?.dispatch("ping", { event: "ping", data: {} }, context);
    expect(sent.at(-1)).toMatchObject({ event: "pong", data: { at: expect.any(Number) } });
    await captured?.dispatch("room.join", { event: "room.join", data: { roomId: "general" } }, context);
    expect(sent.at(-1)).toEqual({ event: "room.joined", data: { roomId: "general" } });
    expect(joined).toEqual(["general"]);
    await captured?.dispatch("room.join", { event: "room.join", data: { roomId: "" } }, context);
    expect(sent.at(-1)).toEqual({
      event: "validation.failed",
      data: { roomId: "Room is invalid." },
    });
    expect(joined).toEqual(["general"]);
    expect(closed).toBe(false);
  } finally {
    await runtime.stop();
  }
});
