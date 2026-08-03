import { parseHost } from "@warbler/config";
import { InvalidRequestError } from "../errors";

/** Validates Host against syntax and a pre-normalized allow-list. */
export function validateRequestHost(request: Request, allowedHosts: readonly string[]): string {
  const raw = request.headers.get("host");
  if (raw === null) throw new InvalidRequestError("Host header is required");
  if (raw.includes("@") || raw.includes("/") || raw.includes("\\")) throw new InvalidRequestError("Malformed Host header");
  const hostname = raw.startsWith("[")
    ? raw.slice(1, raw.indexOf("]"))
    : raw.split(":")[0];
  if (hostname === undefined || hostname.length === 0) throw new InvalidRequestError("Malformed Host header");
  try {
    parseHost(hostname);
  } catch (error) {
    throw new InvalidRequestError("Malformed Host header", 400, { cause: error });
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname.toLowerCase())) {
    throw new InvalidRequestError("Host is not allowed", 421);
  }
  return hostname;
}
