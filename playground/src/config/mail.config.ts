import { env, envBoolean, envNumber, envString } from "@warbler/config";

export const mailConfig = {
  default: "log",

  from: {
    address: envString("MAIL_FROM_ADDRESS", "noreply@example.com"),
    name: env("MAIL_FROM_NAME", "Warbler Playground"),
  },

  transports: {
    smtp: {
      host: envString("MAIL_HOST", "127.0.0.1"),
      port: envNumber("MAIL_PORT", 587),
      secure: envBoolean("MAIL_SECURE", false),
      auth: {
        user: env("MAIL_USERNAME"),
        password: env("MAIL_PASSWORD"),
      },
      tls: {
        rejectUnauthorized: envBoolean("MAIL_TLS_REJECT_UNAUTHORIZED", true),
      },
      timeoutMs: envNumber("MAIL_TIMEOUT_MS", 10_000),
    },
    log: { enabled: true },
    memory: { enabled: false },
  },

  limits: {},
} as const;
