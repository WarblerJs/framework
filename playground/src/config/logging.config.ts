import { envBoolean, envNumber, envString } from "@warblerjs/config";

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
  environment: envString("APP_ENV", "development"),

  /*
   * HTTP request/access logging.
   *
   * When disabled, Warbler selects a quiet HTTP handler at startup. The request
   * path avoids request-log formatting, request-log objects, logging-only timing,
   * and stdout writes for successful requests.
   */
  requests: envBoolean("LOG_REQUESTS", envString("APP_ENV", "development") !== "production"),

  /*
   * Runtime lifecycle informational logs.
   *
   * Covers framework-owned runtime stop/status messages. Disable in production
   * to keep process output quiet outside exceptional conditions.
   */
  runtime: envBoolean("LOG_RUNTIME", envString("APP_ENV", "development") !== "production"),

  /*
   * Transport informational logs.
   *
   * Used by framework-owned transport startup/stop notices. This does not disable
   * transports or change routing, validation, security, or application behavior.
   */
  transports: envBoolean("LOG_TRANSPORTS", envString("APP_ENV", "development") !== "production"),

  /*
   * WebSocket infrastructure logs.
   *
   * When disabled, Warbler avoids connection/message/disconnect log formatting
   * and logging-only timing while preserving subscriptions, publishing, guards,
   * validators, rate limits, and error boundaries.
   */
  websocket: envBoolean("LOG_WEBSOCKET", envString("APP_ENV", "development") !== "production"),

  /*
   * Error logging.
   *
   * Enabled by default in every environment. Error logs never include request
   * bodies, credentials, passwords, tokens, or secrets.
   */
  errors: envBoolean("LOG_ERRORS", true),

  /*
   * Fatal process logging.
   *
   * Enabled by default in every environment. This is only for process-level
   * uncaught exceptions/unhandled rejections that escape normal boundaries.
   */
  fatal: envBoolean("LOG_FATAL", true),

  /*
   * Startup output and debug logs.
   *
   * Kept separate from request logging because startup is outside the request hot
   * path. Production defaults keep it quiet unless explicitly enabled.
   */
  startup: envBoolean("LOG_STARTUP", envString("APP_ENV", "development") !== "production"),
  debug: envBoolean("LOG_DEBUG", envString("APP_ENV", "development") !== "production"),

  channels: {
    console: {
      enabled: envBoolean("LOG_CONSOLE", true),
    },
    file: {
      enabled: envBoolean("LOG_FILE", true),
      path: envString("LOG_FILE_PATH", "storage/logs"),
      rotation: "daily",
      retentionDays: envNumber("LOG_RETENTION_DAYS", 14),
      cleanup: "internal",
      format: "pretty",
    },
  },
} as const;
