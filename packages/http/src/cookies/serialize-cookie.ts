import { InvalidRequestError } from "../errors";
import { safeHeaderValue } from "../internal/header-value";
import type { CookieOptions } from "./cookie-options";

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

/** Serializes one cookie while enforcing prefix and header-injection constraints. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!COOKIE_NAME.test(name)) throw new InvalidRequestError("Invalid cookie name");
  safeHeaderValue(value, "cookie value");
  if (name.startsWith("__Host-") && (options.secure !== true || options.path !== "/" || options.domain !== undefined)) {
    throw new InvalidRequestError("__Host- cookies require Secure, Path=/, and no Domain");
  }
  if (options.sameSite === "None" && options.secure !== true) {
    throw new InvalidRequestError("SameSite=None cookies require Secure");
  }
  let output = `${name}=${encodeURIComponent(value)}`;
  if (options.domain !== undefined) output += `; Domain=${safeHeaderValue(options.domain, "cookie domain")}`;
  if (options.path !== undefined) output += `; Path=${safeHeaderValue(options.path, "cookie path")}`;
  if (options.maxAge !== undefined) {
    if (!Number.isSafeInteger(options.maxAge) || options.maxAge < 0) throw new InvalidRequestError("Invalid cookie Max-Age");
    output += `; Max-Age=${options.maxAge}`;
  }
  if (options.expires !== undefined) {
    if (!Number.isFinite(options.expires.getTime())) throw new InvalidRequestError("Invalid cookie expiration");
    output += `; Expires=${options.expires.toUTCString()}`;
  }
  if (options.httpOnly === true) output += "; HttpOnly";
  if (options.secure === true) output += "; Secure";
  if (options.sameSite !== undefined) output += `; SameSite=${options.sameSite}`;
  if (options.priority !== undefined) output += `; Priority=${options.priority}`;
  if (options.partitioned === true) output += "; Partitioned";
  return output;
}
