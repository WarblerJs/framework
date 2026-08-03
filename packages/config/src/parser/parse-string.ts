import { ConfigError } from "../errors";

const ENCODER = new TextEncoder();

/** Validates a non-empty string, optionally enforcing a maximum UTF-8 byte length. */
export function parseString(value: unknown, maximumBytes = Number.MAX_SAFE_INTEGER): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1
  ) {
    throw new ConfigError("value must be a non-empty string and maximumBytes must be positive");
  }
  if (ENCODER.encode(value).byteLength > maximumBytes) {
    throw new ConfigError(`string exceeds the ${maximumBytes}-byte limit`);
  }
  return value;
}
