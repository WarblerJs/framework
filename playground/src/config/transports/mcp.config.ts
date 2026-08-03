export const mcpConfig = {
    protocol: {
      version: "2024-11-05",   // Target specification version
      role: "server",          // ["server", "client"]
    },
  
    transport: {
      // MCP typically builds on JSON-RPC 2.0 via SSE or Stdio
      layer: "sse",            // ["sse", "stdio"]
      sse: {
        endpoint: "/absolute/path/to/mcp",
        heartbeatIntervalMs: 10_000,
      },
    },
  
    // JSON-RPC specification limits
    jsonRpc: {
      maxMessageSize: "2mb",
      maxBatchRequests: 10,    // Max requests allowed in a single JSON-RPC batch array
      requestTimeoutMs: 15_000,
    },
  
    // Semantic layer resource boundaries (Tools, Prompts, Resources)
    capabilities: {
      tools: {
        enabled: true,
        maxCount: 200,         // Absolute tool index size limit for LLM context optimization
        maxArgumentsSize: "64kb",
      },
      prompts: {
        enabled: true,
        maxCount: 50,
      },
      resources: {
        enabled: true,
        maxSizePerResource: "5mb", // Maximum document text payload to push to the LLM agent
        allowedSchemes: ["file", "db", "http"],
      },
    },
  
    rateLimit: {
      enabled: true,
      perClient: {
        windowMs: 60_000,
        maxCalls: 300,        // Protects your backend system from infinite LLM execution loops
      },
      onExceeded: "error_response", // Sends a standard JSON-RPC internal application error code (-32000)
    },
  } as const;
  