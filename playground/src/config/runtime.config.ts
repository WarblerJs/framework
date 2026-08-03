export default {
  network: {
    host: "0.0.0.0",
    bindInterface: undefined,// ethernet interface to bind to, e.g. "en0" or "eth0". If undefined, binds to all interfaces.
  },

  transports: {
    http: {
      enabled: true,
      port: 3000,
    },

    websocket: {
      enabled: true,
      mode: "shared-http",
      port: 8443,
    },

    tcp: {
      enabled: false,
      port: 9000,
    },

    udp: {
      enabled: false,
      port: 9001,
    },

    mcp: {
      enabled: false,
      port: 8080,
    },

    webrtc: {
      enabled: false,

      signaling: {
        port: 3001,
      },
    },
  },

  telemetry: {
    metrics: {
      enabled: true,
      host: "127.0.0.1",
      port: 9090,
      path: "/metrics",
    },

    healthCheck: {
      enabled: true,
      host: "127.0.0.1",
      port: 8081,
      path: "/healthz",
    },
  },
} as const;
  