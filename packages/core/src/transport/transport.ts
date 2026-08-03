/** Built-in transport identifiers supported by Warbler. */
export const Transport = Object.freeze({
  HTTP: "http",
  WEBSOCKET: "websocket",
  TCP: "tcp",
  UDP: "udp",
  WEBRTC: "webrtc",
  MCP: "mcp",
} as const);

/** A built-in Warbler transport identifier. */
export type Transport = (typeof Transport)[keyof typeof Transport];
