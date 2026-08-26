import {
  envBoolean,
  envNumber,
  envString,
} from "@warblerjs/config";

export default {
  network: { host: envString('APP_HOST','0.0.0.0'), bindInterface: undefined },
  transports: {
    http: {
      enabled: envBoolean("HTTP_ENABLED", true),
      port: envNumber(
        "APP_HTTP_PORT",
        envNumber("APP_HTTTP_PORT", 3000),
      ),
    },
    websocket: {
      enabled: envBoolean("WS_ENABLED", false),
      mode: "standalone",
      port: envNumber("WS_PORT", 3001),
    },
    tcp: {
      enabled: envBoolean("TCP_ENABLED", false),
      port: envNumber("TCP_PORT", 9000),
    },
    udp: {
      enabled: envBoolean("UDP_ENABLED", false),
      port: envNumber("UDP_PORT", 9001),
    },
    mcp: {
      enabled: envBoolean("MCP_ENABLED", false),
      port: envNumber("MCP_PORT", 8080),
    },
    webrtc: {
      enabled: envBoolean("WEBRTC_ENABLED", false),
      signaling: {
        port: envNumber("WEBRTC_SIGNALING_PORT", 3002),
      },
    },
  },
  telemetry: {
    metrics: {
      enabled: envBoolean("METRICS_ENABLED", false),
      host: envString("APP_HOST", "0.0.0.0"),
      port: envNumber("METRICS_PORT", 9090),
      path: "/metrics",
    },
    healthCheck: {
      enabled: envBoolean("HEALTH_CHECK_ENABLED", false),
      host: envString("APP_HOST", "0.0.0.0"),
      port: envNumber("HEALTH_CHECK_PORT", 8081),
      path: "/healthz",
    },
  },
} as const;
