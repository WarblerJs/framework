import { ConfigError } from "../errors";
import { parseIp } from "./parse-ip";

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/iu;

/** Validates and returns an IP address or DNS hostname. */
export function parseHost(value: unknown): string {
  if (typeof value !== "string" || value.length > 253 || value.length === 0) {
    throw new ConfigError("host must be a non-empty string no longer than 253 characters");
  }
  try {
    return parseIp(value);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
  }
  if (/^[\d.]+$/u.test(value) || value.includes(":")) {
    throw new ConfigError("host must be a valid IP address or DNS hostname");
  }
  const host = value.endsWith(".") ? value.slice(0, -1) : value;
  const labels = host.split(".");
  for (const label of labels) {
    if (!HOST_LABEL.test(label)) throw new ConfigError("host must be a valid IP address or DNS hostname");
  }
  return value;
}
