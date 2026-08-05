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
