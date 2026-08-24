import { encoding } from "@warblerjs/crypto";
import { EmailEncodingError } from "../errors";

const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/u;
const PROTECTED_HEADERS = new Set(["bcc", "cc", "content-id", "content-transfer-encoding", "content-type", "date", "from", "message-id", "mime-version", "reply-to", "subject", "to"]);

/** Validates an RFC-style header field name. */
export function validateHeaderName(name: string, protectedOverride = false): string {
  const normalized = name.trim();
  if (!HEADER_NAME_PATTERN.test(normalized)) throw new EmailEncodingError(`Invalid email header name: ${name}`);
  if (!protectedOverride && PROTECTED_HEADERS.has(normalized.toLowerCase())) {
    throw new EmailEncodingError(`Custom header cannot override ${normalized}.`);
  }
  return normalized;
}

/** Validates header values against CRLF injection. */
export function validateHeaderValue(value: string, name: string): string {
  if (/[\r\n\0]/u.test(value)) throw new EmailEncodingError(`${name} contains forbidden control characters.`);
  return value;
}

/** Encodes non-ASCII header text with RFC 2047 encoded-word syntax. */
export function encodeHeaderValue(value: string): string {
  validateHeaderValue(value, "header");
  if (/^[\x20-\x7E]*$/u.test(value)) return value;
  return `=?UTF-8?B?${encoding.encodeBase64(new TextEncoder().encode(value))}?=`;
}

/** Folds a full header line at a conservative column width. */
export function foldHeader(name: string, value: string): string {
  const line = `${validateHeaderName(name, true)}: ${value}`;
  if (line.length <= 998) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 76) {
    chunks.push(rest.slice(0, 76));
    rest = ` ${rest.slice(76)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}
