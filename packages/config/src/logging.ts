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
}

function environmentOf(input: LoggingConfigInput): LoggingEnvironment {
  const value = input.environment ?? process.env.WARBLER_ENV ?? process.env.NODE_ENV ?? "development";
  if (value === "production" || value === "staging" || value === "development") return value;
  return "development";
}

/** Normalizes logging config into immutable startup policy. */
export function normalizeLoggingConfig(input: LoggingConfigInput = Object.freeze({})): LoggingConfig {
  const environment = environmentOf(input);
  const info = environment !== "production";
  return Object.freeze({
    environment,
    requests: input.requests ?? info,
    runtime: input.runtime ?? info,
    transports: input.transports ?? info,
    websocket: input.websocket ?? info,
    errors: input.errors ?? true,
    fatal: input.fatal ?? true,
    startup: input.startup ?? info,
    debug: input.debug ?? info,
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
