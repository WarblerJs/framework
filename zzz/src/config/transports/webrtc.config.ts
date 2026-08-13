export const webrtcConfig = {
  signaling: { connectionType: "websocket", handshakeTimeoutMs: 10_000 },
  ice: {
    portRange: { min: 40_000, max: 40_500 },
    iceServers: [{ urls: ["stun:stun.invalid"] }],
  },
  dataChannels: {
    maxChannelsPerPeer: 32,
    maxMessageSize: "64kb",
    bufferedAmountLowThreshold: "16kb",
    ordered: false,
  },
  media: {
    enabled: true,
    codecs: { audio: ["opus"], video: ["vp8", "h264"] },
  },
} as const;
