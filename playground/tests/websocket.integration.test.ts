import { expect, test } from "bun:test";
import { startCaptured } from "./helpers";

interface CapturedSocket {
  readonly dispatch: (event: string, message: unknown, context: unknown) => unknown;
}

test("generated WebSocket dispatch invokes Subscribe handlers", async () => {
  let captured: CapturedSocket | undefined;
  const runtime = await startCaptured("websocket", (bindings) => { captured = bindings as CapturedSocket; });
  const sent: unknown[] = [];
  const context = {
    connection: { id: "socket-1", connectedAt: Date.now() },
    send: (message: unknown) => { sent.push(message); return { status: "sent", bytes: 1 }; },
    publish: () => ({ status: "sent", bytes: 1 }),
    join: () => ({ topic: "general", subscribed: true }),
    leave: () => ({ topic: "general", subscribed: false }),
    subscriptions: () => Object.freeze([]),
    close: () => {},
    log: { error: () => {} },
  };
  try {
    await captured?.dispatch("room.join", { event: "room.join", data: { roomId: "general" } }, context);
    expect(sent).toEqual([{ event: "room.joined", data: { roomId: "general" } }]);
  } finally {
    await runtime.stop();
  }
});
