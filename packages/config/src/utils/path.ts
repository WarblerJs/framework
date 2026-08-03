import { ConfigError } from "../errors";

export function joinPath(...parts: readonly string[]): string {
  let result = "";
  for (const part of parts) {
    if (part.includes("\0")) throw new ConfigError("path must not contain null bytes");
    if (part.length === 0) continue;
    if (result.length === 0) {
      result = part.replace(/\/+$/u, "");
      continue;
    }
    result += `/${part.replace(/^\/+|\/+$/gu, "")}`;
  }
  return result || ".";
}
