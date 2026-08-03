export const wsConfig = {
    connection: {
      // Limits applied during the initial HTTP upgrade handshake
      handshake: {
        timeoutMs: 5_000,
        allowedOrigins: ["https://example.com"],
        requireSubprotocol: true,
        allowedSubprotocols: ["v1.json", "v1.protobuf"],
      },
  
      // Resource ceilings per open connection
      limits: {
        // Hard server-level cap for a single inbound frame
        maxFrameSize: "2mb",
        // Memory buffer pool allocated for reassembling fragmented frames
        maxMessageBuffer: "8mb",
        // Protects memory against malicious fragmentation attacks (slow loris)
        maxFragmentsPerMessage: 50,
        backpressureThreshold: "1mb",
      },
  
      // Session health check and drop conditions
      heartbeat: {
        enabled: true,
        intervalMs: 15_000,
        timeoutMs: 5_000,
        // If client misses X consecutive pongs, drop the socket violently
        missedPongsAllowed: 2,
      },
    },
  
    rateLimit: {
      enabled: true,
      perIp: {
        windowMs: 60_000,
        maxConnections: 20,
      },
      messaging: {
        windowMs: 1_000,
        // Prevents a client from flooding the event loop with custom text frames
        maxFramesPerSec: 50,
      },
      onExceeded: "close_socket", // ["reject_handshake", "close_socket", "throttle"]
      closeCode: 4029, // Custom WebSocket close code for rate limits
    },
  } as const;
  