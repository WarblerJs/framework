export const httpConfig = {
  request: {
    body: {
      enabled: true,

      // Hard server-level ceiling for every request body.
      maxSize: "20mb",

      json: {
        enabled: true,
        maxSize: "1mb",
        maxDepth: 12,
        maxKeys: 2_000,
      },

      text: {
        enabled: true,
        maxSize: "1mb",
      },

      urlEncoded: {
        enabled: true,
        maxSize: "1mb",
        maxFields: 1_000,
        maxFieldSize: "64kb",
      },

      multipart: {
        enabled: true,
        maxSize: "20mb",

        maxFiles: 10,
        maxFileSize: "5mb",

        maxFields: 100,
        maxFieldSize: "64kb",

        allowedMimeTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ],

        // Future optional feature:
        // inspectFileSignatures: true,
      },

      unknownContentType: "reject",
    },

    headers: {
      maxCount: 100,

      // Bun defaults to a 16 KiB maximum HTTP-header size.
      // Keep Warbler's default aligned unless Bun is started
      // with a larger --max-http-header-size value.
      maxSize: "16kb",

      maxNameSize: "256b",
      maxValueSize: "8kb",
    },

    query: {
      maxParameters: 100,
      maxKeySize: "256b",
      maxValueSize: "4kb",
      maxDepth: 8,
    },

    cookies: {
      maxCount: 50,
      maxSize: "8kb",
      maxNameSize: "256b",
      maxValueSize: "4kb",
    },

    path: {
      maxSize: "8kb",
      maxParameters: 32,
      maxParameterSize: "2kb",
    },

    timeouts: {
      // Framework validation deadlines.
      headers: 5_000,
      body: 30_000,
      request: 60_000,

      // Milliseconds, like its siblings above. @warbler/http converts this to whole seconds
      // and clamps it to Bun's Bun.serve({ idleTimeout }) ceiling of 255 seconds before it
      // ever reaches Bun — do not put a raw seconds value here, it would be read as ms.
      idle: 10_000,
    },
  },

  rateLimit: {
    enabled: true,

    global: {
      windowMs: 60_000,

      // This is a global emergency ceiling for one server process,
      // not a limit applied independently to each client.
      maxRequests: 10_000,
    },

    perIp: {
      windowMs: 60_000,
      maxRequests: 100,
    },

    perRoute: {
      // "POST /api/auth/login": {
      //   windowMs: 60_000,
      //   maxRequests: 5,
      // },
      //
      // "POST /api/uploads": {
      //   windowMs: 60_000,
      //   maxRequests: 10,
      // },
    },

    onExceeded: "reject",
    statusCode: 429,
    retryAfterHeader: true,

    trustProxy: false,
    trustedProxies: [],
  },
} as const;