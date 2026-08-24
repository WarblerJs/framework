# Warbler Logging Configuration

Warbler resolves `src/config/logging.config.ts` once during runtime startup. The
resolved policy is passed to transports so production request and WebSocket hot
paths can use quiet handlers rather than building log metadata and suppressing it
later.

```ts
import { env } from "@warblerjs/config";

export const loggingConfig = {
  environment: env("APP_ENV", "production"),
  requests: env.bool("LOG_REQUESTS", false),
  runtime: env.bool("LOG_RUNTIME", false),
  transports: env.bool("LOG_TRANSPORTS", false),
  websocket: env.bool("LOG_WEBSOCKET", false),
  errors: env.bool("LOG_ERRORS", true),
  fatal: env.bool("LOG_FATAL", true),
  startup: env.bool("LOG_STARTUP", false),
  debug: env.bool("LOG_DEBUG", false),
} as const;
```

Defaults by environment:

- `development`: request, runtime, transport, WebSocket, error, and fatal logs on.
- `staging`: request, runtime, transport, WebSocket, error, and fatal logs on.
- `production`: request, runtime, transport, WebSocket, startup, and debug logs off; error and fatal logs on.

Security: Warbler-owned logs never include request bodies, credentials, tokens,
passwords, or SMTP credentials. Production client error responses remain sanitized.

Performance: when request/WebSocket logs are off, Warbler selects no-log handler
paths at startup and avoids access-log formatting, logging-only timing, log object
allocation, and stdout writes on successful requests/messages.
