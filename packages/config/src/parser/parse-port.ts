import { ConfigError } from "../errors";
import { parseNumber } from "./parse-number";

/** Parses and validates a TCP or UDP port in the inclusive range 1 through 65535. */
export function parsePort(value: unknown): number {
  let port: number;
  try {
    port = parseNumber(value);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new ConfigError("port must be a safe integer from 1 to 65535", undefined, {
      cause: error,
    });
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError("port must be a safe integer from 1 to 65535");
  }
  return port;
}
