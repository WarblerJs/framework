import { ConfigError } from "../errors";
import { parseBoolean } from "./parse-boolean";

const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

/** Reads a required environment variable by its canonical uppercase name. */
export function parseEnv(
  name: unknown,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  if (typeof name !== "string" || !ENV_NAME_PATTERN.test(name)) {
    throw new ConfigError("environment variable name is invalid");
  }
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new ConfigError(`environment variable ${name} is required`);
  }
  return value;
}

export const envBoolean = (
  key: string,
  fallback: boolean,
): boolean =>
  process.env[key] ? parseBoolean(process.env[key] ) : fallback;

export const envString = (
  key: string,
  fallback: string,
): string =>
  process.env[key] ?? fallback;

export const envNumber = (
  key: string,
  fallback: number,
): number => {
  const value = process.env[key];

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : fallback;
};

/** Callable environment reader with typed helpers for configuration files. */
export interface EnvReader {
  (key: string, fallback: string): string;
  (key: string): string;
  readonly optional: (key: string) => string | undefined;
  readonly int: (key: string, fallback: number) => number;
  readonly bool: (key: string, fallback: boolean) => boolean;
}

const optionalEnv = (key: string): string | undefined => {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? undefined : value;
};

const readEnv = ((key: string, fallback?: string): string => {
  const value = optionalEnv(key);
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  return parseEnv(key);
}) as EnvReader;

/** Reads environment values in project configuration files. */
export const env: EnvReader = Object.freeze(Object.assign(readEnv, {
  optional: optionalEnv,
  int: (key: string, fallback: number): number => {
    const value = optionalEnv(key);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new ConfigError(`environment variable ${key} must be an integer`);
    return parsed;
  },
  bool: (key: string, fallback: boolean): boolean => {
    const value = optionalEnv(key);
    return value === undefined ? fallback : parseBoolean(value);
  },
}));
