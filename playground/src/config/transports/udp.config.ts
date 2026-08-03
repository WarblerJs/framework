export const udpConfig = {
    socket: {
      options: {
        reuseAddress: true,     // Allows immediate binding without waiting for port release
        broadcast: false,
      },
  
      // Kernel-level optimization boundaries
      kernelBuffers: {
        // Prevents the OS from dropping bursty incoming packets
        receiveSizeBytes: "4mb",
        sendSizeBytes: "4mb",
      },
  
      // Strict physical payload network parameters
      packet: {
        // Kept at 1472 to guarantee standard 1500-byte Ethernet MTU safety
        // (1500 - 20 byte IPv4 header - 8 byte UDP header)
        maxSize: 1472,
        // Ignore packets smaller than your base application header size
        minSize: 16,
      },
    },
  
    // Because UDP is stateless, we track logical user "sessions" in application memory
    sessionTracking: {
      enabled: true,
      // Tracks unique clients using an IP + Port hash
      sessionTimeoutMs: 30_000,
      maxActiveSessions: 10_000,
    },
  
    rateLimit: {
      enabled: true,
      perIp: {
        windowMs: 1_000,
        // Mitigates UDP DDoS/amplification floods by tracking packets per second per source port
        maxPacketsPerSec: 500,
        maxBytesPerSec: "512kb",
      },
      onExceeded: "silent_drop", // Dropping silently is vital for UDP to prevent reflection amplification
    },
  } as const;
  