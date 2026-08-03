export const tcpConfig = {
    socket: {
      // Low-level OS kernel and network optimizations
      options: {
        noDelay: true,         // Disables Nagle's algorithm for instant streaming
        keepAlive: {
          enabled: true,
          idleSec: 60,         // Time before sending first keepalive probe
          intervalSec: 10,     // Time between subsequent keepalive probes
          probesCount: 5,      // Drops socket if 5 sequential probes fail
        },
      },
  
      // Strict OS memory resource boundaries
      buffers: {
        // Stream chunks read out of the socket at one time
        chunkSize: "64kb",
        // Reassembly window limit before parsing application frames
        maxInboundStreamBuffer: "5mb",
      },
  
      timeouts: {
        handshake: 5_000,      // TLS/App handshake deadline
        idle: 300_000,         // Drop quiet connections after 5 minutes
      },
    },
  
    // Framing strategy parser constraints (e.g., Length-Delimited or Delimiter-Based)
    framing: {
      type: "length_delimited", // ["length_delimited", "delimiter_based"]
      lengthField: {
        offset: 0,
        bytes: 4,              // 32-bit integer length prefix
        endianness: "big",     // Big-endian vs Little-endian network parsing
      },
      maxFrameLength: "10mb",   // Safety guard against massive overflow numbers in the length prefix
    },
  
    rateLimit: {
      enabled: true,
      global: {
        maxConnections: 50_000,
      },
      perIp: {
        maxConnections: 10,
        connectionRateWindowMs: 10_000,
        maxConnectionsPerWindow: 3, // Block IP if it hammers the TCP port with quick reconnects
      },
    },
  } as const;
  