/** Canonical supported request body content types. */
export const ContentType = Object.freeze({
  JSON: "application/json",
  TEXT: "text/plain",
  URL_ENCODED: "application/x-www-form-urlencoded",
  MULTIPART: "multipart/form-data",
} as const);

/** Returns the lowercase media type without parameters. */
export function parseContentType(value: string | null): string {
  if (value === null) return "";
  const separator = value.indexOf(";");
  return (separator === -1 ? value : value.slice(0, separator)).trim().toLowerCase();
}
