export const webrtcConfig = {
    signaling: {
      connectionType: "websocket",    // Internal orchestration routing strategy
      handshakeTimeoutMs: 10_000,
    },
    ice: {
      portRange: { min: 40000, max: 40500 }, // Narrowed down range for simple firewalls
      iceServers: [
        { urls: ["stun:://google.com"] },
        { 
          urls: ["turn:turn.production.infra:3478"],
          username: "transporter_core_agent",
          credential: "env_secured_token_string",
        }
      ],
    },
    dataChannels: {
      maxChannelsPerPeer: 32,
      maxMessageSize: "64kb",         // Optimizes data channel buffers to prevent out-of-order latency
      bufferedAmountLowThreshold: "16kb", // Trigger for backpressure handling
      ordered: false,                 // Default setting optimized for highest throughput streaming
    },
    media: {
      enabled: true,
      codecs: {
        audio: ["opus"],
        video: ["vp8", "h264"],       // Standard high-performance codecs
      },
    },
  }