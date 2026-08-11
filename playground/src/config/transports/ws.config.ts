import type { WebSocketConfig } from "@warbler/websocket";

export const wsConfig = {
  mode: "dedicated",
  security: {
    origins: {
      required: true,
      allowed: ["http://192.168.1.100:3000", "http://localhost:3000"],
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
