export const udpConfig = {
  socket: {
    options: { reuseAddress: true, broadcast: false },
    kernelBuffers: { receiveSizeBytes: "4mb", sendSizeBytes: "4mb" },
    packet: { maxSize: 1472, minSize: 16 },
  },
  sessionTracking: { enabled: true, sessionTimeoutMs: 30_000, maxActiveSessions: 10_000 },
  rateLimit: {
    enabled: true,
    perIp: { windowMs: 1_000, maxPacketsPerSec: 500, maxBytesPerSec: "512kb" },
    onExceeded: "silent_drop",
  },
} as const;
