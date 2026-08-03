import { InvalidRequestError } from "../errors";

export function safeHeaderValue(value: string, name: string): string {
  if (value.includes("\r") || value.includes("\n") || value.includes("\0")) {
    throw new InvalidRequestError(`${name} contains forbidden control characters`);
  }
  return value;
}

export function safeFilename(value: string): string {
  safeHeaderValue(value, "filename");
  const sanitized = value.replace(/["/\\]/gu, "_").trim();
  if (sanitized.length === 0) throw new InvalidRequestError("filename is empty after sanitization");
  return sanitized;
}
