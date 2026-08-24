# Configuration

Export `mailConfig` from `src/config/mail.config.ts`.

```ts
import { env } from "@warblerjs/config";

export const mailConfig = {
  default: "smtp",
  from: {
    address: env("MAIL_FROM_ADDRESS", "noreply@example.com"),
    name: env("MAIL_FROM_NAME", "Warbler"),
  },
  transports: {
    smtp: {
      host: env("MAIL_HOST", "127.0.0.1"),
      port: env.int("MAIL_PORT", 587),
      secure: env.bool("MAIL_SECURE", false),
      auth: {
        user: env.optional("MAIL_USERNAME"),
        password: env.optional("MAIL_PASSWORD"),
      },
      tls: {
        rejectUnauthorized: env.bool("MAIL_TLS_REJECT_UNAUTHORIZED", true),
      },
      timeoutMs: env.int("MAIL_TIMEOUT_MS", 10_000),
    },
    log: { enabled: true },
    memory: { enabled: false },
  },
  limits: {},
} as const;
```

Supported transports are `smtp`, `log`, and `memory`.
