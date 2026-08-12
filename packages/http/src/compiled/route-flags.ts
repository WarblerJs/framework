/** Bit flags precomputed by the compiler for request-hot-path policy checks. */
export const RouteFlag = Object.freeze({
  CSRF_ENABLED: 1 << 0,
  BODY_ENABLED: 1 << 1,
  STREAMING: 1 << 2,
  SSE: 1 << 3,
  STATIC_RESPONSE: 1 << 4,
  FILE_RESPONSE: 1 << 5,
  HTML_RESPONSE: 1 << 6,
  VIEW_CONTEXT: 1 << 7,
} as const);
