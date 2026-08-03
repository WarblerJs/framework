import { ConfigError } from "../errors";

export type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new ConfigError("must be an object", path);
  }
  return value;
}

export function exactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ConfigError("is not supported", `${path}.${key}`);
  }
  for (const key of required) {
    if (!(key in value)) throw new ConfigError("is required", `${path}.${key}`);
  }
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ConfigError("must be a boolean", path);
  return value;
}

export function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ConfigError(`must be a safe integer from ${minimum} to ${maximum}`, path);
  }
  return value;
}

export function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError("must be a non-empty string", path);
  }
  return value;
}

export function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  for (const choice of choices) {
    if (value === choice) return choice;
  }
  throw new ConfigError(`must be one of: ${choices.join(", ")}`, path);
}

export function array(
  value: unknown,
  path: string,
  maximum = Number.MAX_SAFE_INTEGER,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ConfigError(`must be an array with at most ${maximum} entries`, path);
  }
  return value;
}

export function pathValue(value: unknown, path: string): string {
  const parsed = stringValue(value, path);
  if (!parsed.startsWith("/") || parsed.includes("\0")) {
    throw new ConfigError("must be an absolute URL path without null bytes", path);
  }
  return parsed;
}
