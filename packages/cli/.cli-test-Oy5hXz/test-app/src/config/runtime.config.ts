export default {
  network: { host: "127.0.0.1" },
  transports: {
    http: { enabled: true, port: 3000 },
    websocket: { enabled: false }, tcp: { enabled: false }, udp: { enabled: false },
    mcp: { enabled: false }, webrtc: { enabled: false },
  },
  telemetry: {
    metrics: { enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" },
    healthCheck: { enabled: false, host: "127.0.0.1", port: 9091, path: "/health" },
  },
} as const;
