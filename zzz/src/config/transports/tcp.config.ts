export const tcpConfig = {
  socket: {
    options: {
      noDelay: true,
      keepAlive: { enabled: true, idleSec: 60, intervalSec: 10, probesCount: 5 },
    },
    buffers: { chunkSize: "64kb", maxInboundStreamBuffer: "5mb" },
    timeouts: { handshake: 5_000, idle: 300_000 },
  },
  framing: {
    type: "length_delimited",
    lengthField: { offset: 0, bytes: 4, endianness: "big" },
    maxFrameLength: "10mb",
  },
  rateLimit: {
    enabled: true,
    global: { maxConnections: 50_000 },
    perIp: { maxConnections: 10, connectionRateWindowMs: 10_000, maxConnectionsPerWindow: 3 },
  },
} as const;
