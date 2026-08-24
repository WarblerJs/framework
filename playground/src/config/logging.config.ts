import { env } from "@warblerjs/config";

export const loggingConfig = {
  /*
   * Application environment.
   *
   * development and staging keep framework-owned informational logs enabled so
   * route, transport, and WebSocket behavior is easy to inspect while building.
   *
   * production disables informational hot-path logs by default. Errors and fatal
   * process failures stay enabled unless explicitly overridden below.
   */
  environment: env("APP_ENV", "development"),

  /*
   * HTTP request/access logging.
   *
   * When disabled, Warbler selects a quiet HTTP handler at startup. The request
   * path avoids request-log formatting, request-log objects, logging-only timing,
   * and stdout writes for successful requests.
   */
  requests: env.bool("LOG_REQUESTS", env("APP_ENV", "development") !== "production"),

  /*
   * Runtime lifecycle informational logs.
   *
   * Covers framework-owned runtime stop/status messages. Disable in production
   * to keep process output quiet outside exceptional conditions.
   */
  runtime: env.bool("LOG_RUNTIME", env("APP_ENV", "development") !== "production"),

  /*
   * Transport informational logs.
   *
   * Used by framework-owned transport startup/stop notices. This does not disable
   * transports or change routing, validation, security, or application behavior.
   */
  transports: env.bool("LOG_TRANSPORTS", env("APP_ENV", "development") !== "production"),

  /*
   * WebSocket infrastructure logs.
   *
   * When disabled, Warbler avoids connection/message/disconnect log formatting
   * and logging-only timing while preserving subscriptions, publishing, guards,
   * validators, rate limits, and error boundaries.
   */
  websocket: env.bool("LOG_WEBSOCKET", env("APP_ENV", "development") !== "production"),

  /*
   * Error logging.
   *
   * Enabled by default in every environment. Error logs never include request
   * bodies, credentials, passwords, tokens, or secrets.
   */
  errors: env.bool("LOG_ERRORS", true),

  /*
   * Fatal process logging.
   *
   * Enabled by default in every environment. This is only for process-level
   * uncaught exceptions/unhandled rejections that escape normal boundaries.
   */
  fatal: env.bool("LOG_FATAL", true),

  /*
   * Startup output and debug logs.
   *
   * Kept separate from request logging because startup is outside the request hot
   * path. Production defaults keep it quiet unless explicitly enabled.
   */
  startup: env.bool("LOG_STARTUP", env("APP_ENV", "development") !== "production"),
  debug: env.bool("LOG_DEBUG", env("APP_ENV", "development") !== "production"),

  channels: {
    console: {
      enabled: env.bool("LOG_CONSOLE", true),
    },
    file: {
      enabled: env.bool("LOG_FILE", true),
      path: env("LOG_FILE_PATH", "storage/logs"),
      rotation: "daily",
      retentionDays: env.int("LOG_RETENTION_DAYS", 14),
      cleanup: "internal",
      format: "pretty",
    },
  },
} as const;
