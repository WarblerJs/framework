import { InvalidRequestError } from "../errors";
import { type HeadersInput, safeHeaderValue, toHeaders } from "../internal/header-value";
import type { ResponseOptions } from "./response-types";

function headersWithDefault(input: HeadersInput | undefined, name: string, value: string): Headers {
  const headers = toHeaders(input);
  if (!headers.has(name)) headers.set(name, value);
  return headers;
}

/** Creates a native JSON response and preserves explicit content-type headers. */
export function JsonRes(value: unknown, options: ResponseOptions = {}): Response {
  return new Response(JSON.stringify(value), {
    status: options.status,
    headers: headersWithDefault(options.headers, "content-type", "application/json; charset=utf-8"),
  });
}

/** Creates a native HTML response and preserves explicit content-type headers. */
export function HtmlRes(value: string, options: ResponseOptions = {}): Response {
  return new Response(value, {
    status: options.status,
    headers: headersWithDefault(options.headers, "content-type", "text/html; charset=utf-8"),
  });
}

/** Creates a native plain-text response and preserves explicit content-type headers. */
export function TextRes(value: string, options: ResponseOptions = {}): Response {
  return new Response(value, {
    status: options.status,
    headers: headersWithDefault(options.headers, "content-type", "text/plain; charset=utf-8"),
  });
}

/**
 * Creates a guarded redirect response.
 *
 * This rejects header injection but callers must independently restrict untrusted targets to
 * prevent open redirects.
 */
export function RedirectRes(location: string, status = 302, headers?: HeadersInput): Response {
  if (![301, 302, 303, 307, 308].includes(status)) throw new InvalidRequestError("Invalid redirect status", 500);
  const output = toHeaders(headers);
  if (!output.has("location")) output.set("location", safeHeaderValue(location, "location"));
  return new Response(null, { status, headers: output });
}

/** Creates an empty native response. */
export function EmptyRes(status = 204, headers?: HeadersInput): Response {
  return new Response(null, { status, headers: toHeaders(headers) });
}
