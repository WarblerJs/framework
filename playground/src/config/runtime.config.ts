import { envString } from "@warbler/config";

export default {
  network: { host: envString('APP_HOST','0.0.0.0'), bindInterface: undefined },
  transports: {
    http: { enabled: true, port: 3000 },
    websocket: { enabled: false, mode: "standalone", port: 3001 },
    tcp: { enabled: false, port: 9000 },
    udp: { enabled: false, port: 9001 },
    mcp: { enabled: false, port: 8080 },
    webrtc: { enabled: false, signaling: { port: 3002 } },
  },
  telemetry: {
    metrics: { enabled: false, host: "0.0.0.0", port: 9090, path: "/metrics" },
    healthCheck: { enabled: false, host: "0.0.0.0", port: 8081, path: "/healthz" },
  },
} as const;
