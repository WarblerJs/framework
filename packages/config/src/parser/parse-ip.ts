import { ConfigError } from "../errors";

function parseIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/u.test(part)) return false;
    const octet = Number(part);
    if (octet > 255) return false;
  }
  return true;
}

function parseIpv6(value: string): boolean {
  if (!/^[0-9a-f:]+$/iu.test(value) || value.includes(":::")) return false;
  const compressed = value.includes("::");
  if (compressed && value.indexOf("::") !== value.lastIndexOf("::")) return false;
  const parts = value.split(":");
  let groups = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    if (part.length > 4) return false;
    groups++;
  }
  return compressed ? groups < 8 : groups === 8;
}

/** Validates and returns an IPv4 or IPv6 address. */
export function parseIp(value: unknown): string {
  if (typeof value !== "string" || (!parseIpv4(value) && !parseIpv6(value))) {
    throw new ConfigError("IP address must be valid IPv4 or IPv6");
  }
  return value;
}
