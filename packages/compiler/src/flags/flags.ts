/** Compact HTTP route policy flags. */
export const RouteFlag = Object.freeze({
  GET: 1 << 0,
  POST: 1 << 1,
  PUT: 1 << 2,
  PATCH: 1 << 3,
  DELETE: 1 << 4,
  OPTIONS: 1 << 5,
  HEAD: 1 << 6,
  VALIDATION: 1 << 7,
  MIDDLEWARE: 1 << 8,
  GUARD: 1 << 9,
  CSRF: 1 << 10,
  STREAMING: 1 << 11,
  STATIC: 1 << 12,
  VIEW: 1 << 13,
  JSON: 1 << 14,
  HTML: 1 << 15,
  VIEW_CONTEXT: 1 << 16,
  TEXT: 1 << 17,
} as const);

/** Compact WebSocket event policy flags. */
export const SocketFlag = Object.freeze({
  VALIDATION: 1 << 0,
  MIDDLEWARE: 1 << 1,
  GUARD: 1 << 2,
  COMPRESSION: 1 << 3,
  BINARY: 1 << 4,
  AUTHENTICATION: 1 << 5,
  RATE_LIMIT: 1 << 6,
} as const);
