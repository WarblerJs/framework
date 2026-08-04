import { I18nError, I18nErrorCode } from "./errors";
import type { I18nConfig, LocaleDetectionInput } from "./types";
import { matchSupportedLocale } from "./config";

const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/u;
const MAX_HEADER_BYTES = 4096;
const MAX_LANGUAGE_ENTRIES = 32;

export function canonicalizeLocale(value: string): string {
  if (typeof value !== "string" || value.length > 35 || !LOCALE.test(value)) throw new I18nError(I18nErrorCode.INVALID_LOCALE, "Locale is malformed.");
  try { return Intl.getCanonicalLocales(value)[0]!; }
  catch (cause) { throw new I18nError(I18nErrorCode.INVALID_LOCALE, "Locale is malformed.", { cause }); }
}

export function resolveSupportedLocale(value: string, supported: readonly string[]): string | undefined {
  try { return matchSupportedLocale(canonicalizeLocale(value.trim()), supported); } catch { return undefined; }
}

export function parseAcceptLanguage(header: string, supported: readonly string[]): string | undefined {
  if (header.length === 0 || new TextEncoder().encode(header).byteLength > MAX_HEADER_BYTES) return undefined;
  const ranked: Array<Readonly<{ locale: string; quality: number; order: number }>> = [];
  const entries = header.split(",", MAX_LANGUAGE_ENTRIES + 1);
  if (entries.length > MAX_LANGUAGE_ENTRIES) return undefined;
  for (let order = 0; order < entries.length; order++) {
    const fields = entries[order]!.trim().split(";");
    const raw = fields[0]?.trim();
    if (raw === undefined || raw === "*" || fields.length > 2) continue;
    let quality = 1;
    if (fields[1] !== undefined) {
      const match = /^q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/u.exec(fields[1]!.trim());
      if (match === null) continue;
      quality = Number(match[1]);
    }
    const locale = resolveSupportedLocale(raw, supported);
    if (locale !== undefined && quality > 0) ranked.push(Object.freeze({ locale, quality, order }));
  }
  ranked.sort((a, b) => b.quality - a.quality || a.order - b.order);
  return ranked[0]?.locale;
}

export function resolveLocale(config: I18nConfig, input: LocaleDetectionInput): string {
  const url = input.url === undefined ? undefined : typeof input.url === "string" ? safeUrl(input.url) : input.url;
  for (const source of config.detection) {
    const candidate = source === "explicit" ? input.explicit
      : source === "path" ? firstPathSegment(url)
      : source === "query" ? url?.searchParams.get(config.queryName) ?? undefined
      : source === "cookie" ? input.cookies?.[config.cookieName]
      : undefined;
    if (source === "header") {
      const header = input.headers instanceof Headers ? input.headers.get(config.headerName) : input.headers?.[config.headerName];
      const locale = header === null || header === undefined ? undefined : parseAcceptLanguage(header, config.supportedLocales);
      if (locale !== undefined) return locale;
    } else if (candidate !== undefined) {
      const locale = resolveSupportedLocale(candidate, config.supportedLocales);
      if (locale !== undefined) return locale;
    }
  }
  return config.defaultLocale;
}
function safeUrl(value: string): URL | undefined { try { return new URL(value, "http://warbler.invalid"); } catch { return undefined; } }
function firstPathSegment(url: URL | undefined): string | undefined { return url?.pathname.split("/").find(Boolean); }
