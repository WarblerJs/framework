export const mcpConfig = {
  protocol: { version: "2024-11-05", role: "server" },
  transport: {
    layer: "sse",
    sse: { endpoint: "/mcp", heartbeatIntervalMs: 10_000 },
  },
  jsonRpc: { maxMessageSize: "2mb", maxBatchRequests: 10, requestTimeoutMs: 15_000 },
  capabilities: {
    tools: { enabled: true, maxCount: 200, maxArgumentsSize: "64kb" },
    prompts: { enabled: true, maxCount: 50 },
    resources: { enabled: true, maxSizePerResource: "5mb", allowedSchemes: ["file"] },
  },
  rateLimit: {
    enabled: true,
    perClient: { windowMs: 60_000, maxCalls: 300 },
    onExceeded: "error_response",
  },
} as const;
