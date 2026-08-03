import { ConfigError } from "../errors";

const INTERFACE_PATTERN = /^[a-zA-Z0-9_.:-]{1,64}$/u;

/** Validates and returns an operating-system network interface name. */
export function parseNetworkInterface(value: unknown): string {
  if (typeof value !== "string" || !INTERFACE_PATTERN.test(value)) {
    throw new ConfigError("network interface must contain 1 to 64 safe name characters");
  }
  return value;
}
