import { ConfigError } from "../errors";

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
