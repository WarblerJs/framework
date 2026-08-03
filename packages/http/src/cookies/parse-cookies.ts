import { InvalidRequestError } from "../errors";

/** Parses a Cookie header into an immutable null-prototype record. */
export function parseCookies(
  header: string | null,
  maxCount = 50,
  maxSize = 8 * 1024,
): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null);
  if (header === null || header.length === 0) return Object.freeze(output);
  if (new TextEncoder().encode(header).byteLength > maxSize) throw new InvalidRequestError("Cookie header limit exceeded");
  const values = header.split(";");
  if (values.length > maxCount) throw new InvalidRequestError("Cookie count limit exceeded");
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new InvalidRequestError("Malformed Cookie header");
    const name = value.slice(0, separator).trim();
    const encoded = value.slice(separator + 1).trim();
    try {
      output[name] = decodeURIComponent(encoded);
    } catch (error) {
      throw new InvalidRequestError("Malformed cookie encoding", 400, { cause: error });
    }
  }
  return Object.freeze(output);
}
