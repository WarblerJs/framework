import { assertCookieHeaderWithinLimits } from "./parse-cookies";

/**
 * Resolves the request's cookies as a `Bun.CookieMap`.
 *
 * Reuses `BunRequest.cookies` when present (already lazily parsed by Bun for every
 * request served through `Bun.serve({ routes })` — effectively free), falling back
 * to explicit construction for plain `Request` objects (unit tests, non-native
 * transports). A byte-size/count pre-check still rejects oversized `Cookie` headers
 * before parsing; `Bun.CookieMap` itself parses leniently and silently drops
 * individually malformed pairs.
 */
export function requestCookieMap(request: Request): Bun.CookieMap {
  const native = request as Request & { readonly cookies?: unknown };
  if (native.cookies instanceof Bun.CookieMap) return native.cookies;
  const header = request.headers.get("cookie");
  assertCookieHeaderWithinLimits(header);
  return new Bun.CookieMap(header ?? "");
}

/** Plain-record view of a request's cookies, for validator input (`cookieRules`). */
export function cookieMapRecord(cookies: Bun.CookieMap): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(cookies));
}
