import { defineHandler } from "@warblerjs/core";
import { defineWebSocketGraph, type WebSocketEventKey, type WebSocketEventTable, type WebSocketGraphEvent } from "../src";

const handler = defineHandler({
  run: (_ctx: unknown) => undefined,
});

const acceptedOpen: WebSocketEventKey = "OPEN";
const acceptedMessage: WebSocketEventKey = "MSG room.join";

defineWebSocketGraph({
  events: {
    OPEN: handler,
    DRAIN: handler,
    "MSG room.join": handler,
    "SUB crash": { handler, name: "ws.crash" },
  },
});

const typedEvents: WebSocketEventTable<WebSocketGraphEvent> = {
  [acceptedOpen]: handler,
  [acceptedMessage]: handler,
  // @ts-expect-error unknown lifecycle event
  DRAINE: handler,
};

void typedEvents;
