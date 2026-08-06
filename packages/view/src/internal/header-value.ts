/**
 * Header input shape independent of the ambient `HeadersInit` global, which resolves
 * differently depending on whether a consuming app's tsconfig includes the DOM lib.
 */
export type HeadersInput = Headers | ReadonlyArray<readonly [string, string]> | Record<string, string | ReadonlyArray<string>>;

/** Builds a `Headers` instance from any supported input shape, regardless of ambient lib config. */
export function toHeaders(input: HeadersInput | undefined): Headers {
  const headers = new Headers();
  if (input === undefined) return headers;
  if (input instanceof Headers) {
    input.forEach((value, key) => headers.append(key, value));
    return headers;
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input) headers.append(key, value);
    return headers;
  }
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.append(key, value as string);
    }
  }
  return headers;
}
