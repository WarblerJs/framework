import { ConfigError } from "../errors";

/** Parses a boolean or the exact lowercase strings "true" and "false". */
export function parseBoolean(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ConfigError('boolean must be true, false, "true", or "false"');
}
