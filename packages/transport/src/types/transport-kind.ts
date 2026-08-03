/** Stable identifiers for transport implementations supported by Warbler. */
export const TransportKind = Object.freeze({
  HTTP: "http",
  WEBSOCKET: "websocket",
  TCP: "tcp",
  UDP: "udp",
  MCP: "mcp",
  WEBRTC: "webrtc",
} as const);

/** A stable Warbler transport identifier. */
export type TransportKindValue = (typeof TransportKind)[keyof typeof TransportKind];
