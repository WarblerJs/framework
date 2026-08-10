export function withQuery(url: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const parsed = new URL(url, location.origin);
  for (const [key, value] of Object.entries(params)) value == null ? parsed.searchParams.delete(key) : parsed.searchParams.set(key, String(value));
  return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
}
