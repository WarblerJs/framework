import { envString } from "@warblerjs/config";
import type { WebSocketConfig } from "@warblerjs/websocket";
export const wsConfig = {
  mode: "dedicated",
  security: {
    origins: {
      required: true,
      allowed:  envString(
        "WS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
      )
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    },
    authentication: { required: false },
    protocols: { allowed: ["warbler.json.v1"], required: false },
  },
  messages: {
    format: "json",
    maxPayloadLength: "1mb",
    maxEventNameLength: 128,
    maxMessageIdLength: 128,
    unknownEvent: "send-error",
  },
  compression: { enabled: false, threshold: "4kb" },
  timeouts: { idle: "60s", handler: "30s" },
  backpressure: { limit: "1mb", closeOnLimit: true, strategy: "reject-new" },
  limits: {
    totalConnections: 1000,
    connectionsPerIp: 20,
    subscriptionsPerConnection: 100,
    eventsPerSecond: 50,
  },
  bun: { sendPings: true, publishToSelf: false },
} as const satisfies WebSocketConfig;
