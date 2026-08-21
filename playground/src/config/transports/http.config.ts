export const httpConfig = {
  host: "0.0.0.0",
  port: 3000, 
  allowedHosts: ["127.0.0.1","192.168.1.100", "localhost", '0.0.0.0'],
  request: {
    body: {
      enabled: true,
      maxSize: "20mb",
      unknownContentType: "reject",
      json: { enabled: true, maxSize: "1mb", maxDepth: 12, maxKeys: 500 },
      text: { enabled: true, maxSize: "256kb" },
      urlEncoded: { enabled: true, maxSize: "256kb", maxFields: 100, maxFieldSize: "16kb" },
      multipart: {
        enabled: true,
        maxSize: "2mb",
        maxFiles: 4,
        maxFileSize: "1mb",
        maxFields: 32,
        maxFieldSize: "16kb",
        allowedMimeTypes: ["image/png", "application/pdf", "application/zip"],
      },
    },
    headers: { maxCount: 100, maxSize: "16kb", maxNameSize: "256b", maxValueSize: "8kb" },
    query: { maxParameters: 100, maxDepth: 8 },
    cookies: { maxCount: 50, maxSize: "8kb" },
    path: { maxSize: "8kb", maxParameters: 32 },
    timeouts: { headers: 5_000, body: 30_000, request: 60_000, idle: 30_000 },
  },
  csrf: {
    enabled: false,
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    headerName: "x-csrf-token",
    cookieName: "__Host-warbler-csrf",
    fieldName: "_csrf",
    // "form" lets a plain HTML <form> submit the {{{ csrfField }}} hidden input
    // directly in the POST body; "header" still covers JS/fetch-driven requests
    // that set x-csrf-token explicitly.
    sources: ["header", "form"],
    strictSources: true,
  },
  security: {
    enabled: true,
    contentSecurityPolicy: "default-src 'self'; connect-src 'self' ws://192.168.1.100:3001 ws://localhost:3001 ws://127.0.0.1:3001 ",
    frameOptions: "DENY",
  },
  static: {
    enabled: true,
    root: "public",
    prefix: "/",
    indexFiles: ["index.html"],
    exposeDotfiles: false,
    exposeSourceMaps: false,
    cacheControl: { enabled: true, immutableAssets: true },
  },
  rateLimit: { trustProxy: false, trustedProxies: [] },
} as const;
