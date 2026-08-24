export const httpConfig = {
  request: {
    body: { unknownContentType: "reject" },
    headers: {}, query: {}, cookies: {}, path: {},
    timeouts: { idle: 10_000 },
  },
  rateLimit: { onExceeded: "reject", statusCode: 429 },
} as const;
