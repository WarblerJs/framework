import { resolve } from "node:path";

/** Runtime environment names that drive logging defaults. */
export type LoggingEnvironment = "development" | "staging" | "production";

/** Fine-grained logging policy normalized once during startup. */
export interface LoggingConfig {
  readonly environment: LoggingEnvironment;
  readonly requests: boolean;
  readonly runtime: boolean;
  readonly transports: boolean;
  readonly websocket: boolean;
  readonly errors: boolean;
  readonly fatal: boolean;
  readonly startup: boolean;
  readonly debug: boolean;
  readonly channels: LoggingChannelsConfig;
}

export interface LoggingChannelsConfig {
  readonly console: Readonly<{ readonly enabled: boolean }>;
  readonly file: LoggingFileChannelConfig;
}

export interface LoggingFileChannelConfig {
  readonly enabled: boolean;
  readonly path: string;
  readonly rotation: "daily";
  readonly retentionDays: number;
  readonly cleanup: "internal";
  readonly format: "pretty";
}

/** User-facing `loggingConfig` shape. */
export interface LoggingConfigInput {
  readonly environment?: LoggingEnvironment;
  readonly requests?: boolean;
  readonly runtime?: boolean;
  readonly transports?: boolean;
  readonly websocket?: boolean;
  readonly errors?: boolean;
  readonly fatal?: boolean;
  readonly startup?: boolean;
  readonly debug?: boolean;
  readonly logging?: LoggingConfigInput;
  readonly level?: "debug" | "info" | "warning" | "error" | "fatal";
  readonly enabled?: boolean;
  readonly channels?: Readonly<{
    readonly console?: Readonly<{ readonly enabled?: boolean }>;
    readonly file?: Readonly<{
      readonly enabled?: boolean;
      readonly path?: string;
      readonly rotation?: "daily";
      readonly retentionDays?: number;
      readonly cleanup?: "internal";
      readonly format?: "pretty";
    }>;
  }>;
}

function environmentOf(input: LoggingConfigInput): LoggingEnvironment {
  const value = input.environment ?? process.env.WARBLER_ENV ?? process.env.NODE_ENV ?? "development";
  if (value === "production" || value === "staging" || value === "development") return value;
  return "development";
}

/** Normalizes logging config into immutable startup policy. */
export function normalizeLoggingConfig(input: LoggingConfigInput = Object.freeze({})): LoggingConfig {
  const source = input.logging ?? input;
  const environment = environmentOf(source);
  const info = environment !== "production";
  const enabled = source.enabled ?? true;
  const file = source.channels?.file;
  return Object.freeze({
    environment,
    requests: enabled && (source.requests ?? info),
    runtime: enabled && (source.runtime ?? info),
    transports: enabled && (source.transports ?? info),
    websocket: enabled && (source.websocket ?? info),
    errors: enabled && (source.errors ?? true),
    fatal: enabled && (source.fatal ?? true),
    startup: enabled && (source.startup ?? info),
    debug: enabled && (source.debug ?? info),
    channels: Object.freeze({
      console: Object.freeze({ enabled: source.channels?.console?.enabled ?? true }),
      file: Object.freeze({
        enabled: enabled && (file?.enabled ?? false),
        path: normalizeLogPath(file?.path ?? "storage/logs"),
        rotation: "daily" as const,
        retentionDays: normalizeRetention(file?.retentionDays ?? 14),
        cleanup: "internal" as const,
        format: "pretty" as const,
      }),
    }),
  });
}

/** Loads `src/config/logging.config.ts`, accepting `loggingConfig` or default export. */
export async function loadLoggingConfig(projectRoot: string): Promise<LoggingConfig> {
  const path = resolve(projectRoot, "src/config/logging.config.ts");
  if (!await Bun.file(path).exists()) return normalizeLoggingConfig();
  const module = await import(path) as Readonly<Record<string, unknown>>;
  const candidate = module.loggingConfig ?? module.default ?? Object.freeze({});
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new TypeError("Logging configuration must export loggingConfig or a default object.");
  }
  return normalizeLoggingConfig(candidate as LoggingConfigInput);
}

function normalizeRetention(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3650) throw new TypeError("Logging file retentionDays must be a safe integer between 1 and 3650.");
  return value;
}

function normalizeLogPath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw new TypeError("Logging file path must be a non-empty safe string.");
  return value;
}
