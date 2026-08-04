import { resolveLocale } from "./locale";
import type { I18nConfig, LocaleDetectionInput, TranslationParameters, Translator } from "./types";

export interface TranslationAccessor {
  readonly locale: string;
  tr(key: string, parameters?: TranslationParameters): string;
}

/** Creates the stable, compact translation members mixed into an HTTP request. */
export function createRequestTranslation(translator: Translator, config: I18nConfig, input: LocaleDetectionInput): TranslationAccessor {
  const locale = resolveLocale(config, input);
  return Object.freeze({ locale, tr: (key: string, parameters?: TranslationParameters) => translator.tr(locale, key, parameters) });
}

/** Creates locale/translation members stored on a WebSocket context; catalogs remain shared. */
export function createSocketTranslation(translator: Translator, config: I18nConfig, input: LocaleDetectionInput): TranslationAccessor {
  return createRequestTranslation(translator, config, input);
}

export interface LocalizedRequest extends Request, TranslationAccessor {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly cookies: Readonly<Record<string, string>>;
  readonly context: unknown;
}

/** Augments Bun's native request once while preserving Request identity for guards and validators. */
export function localizeRequest(
  native: Request,
  translator: Translator,
  config: I18nConfig,
  options: Readonly<{ readonly maxQueryParameters?: number; readonly maxCookies?: number }> = {},
): LocalizedRequest {
  if (isLocalizedRequest(native)) return native;
  const url = new URL(native.url);
  const cookies = parseCookieHeader(native.headers.get("cookie"), options.maxCookies ?? 50);
  const locale = resolveLocale(config, { url, cookies, headers: native.headers });
  const properties: PropertyDescriptorMap = {
    query: immutableValue(parseQuery(url, options.maxQueryParameters ?? 100)),
    cookies: immutableValue(cookies),
    context: immutableValue(undefined),
    locale: immutableValue(locale),
    tr: immutableValue((key: string, parameters?: TranslationParameters) => translator.tr(locale, key, parameters)),
  };
  if (!("params" in native)) properties.params = immutableValue(Object.freeze(Object.create(null) as Record<string, string>));
  Object.defineProperties(native, properties);
  return native as LocalizedRequest;
}

function isLocalizedRequest(value: Request): value is LocalizedRequest {
  return "locale" in value && typeof value.locale === "string" && "tr" in value && typeof value.tr === "function";
}
function immutableValue(value: unknown): PropertyDescriptor {
  return { value, enumerable: true, configurable: false, writable: false };
}
function parseQuery(url: URL, limit: number): Readonly<Record<string, string | readonly string[]>> {
  const result: Record<string, string | readonly string[]> = Object.create(null);
  let count = 0;
  for (const [key, value] of url.searchParams) {
    if (++count > limit) break;
    const current = result[key];
    result[key] = current === undefined ? value : typeof current === "string" ? Object.freeze([current, value]) : Object.freeze([...current, value]);
  }
  return Object.freeze(result);
}
function parseCookieHeader(header: string | null, limit: number): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  if (header === null || header.length === 0) return Object.freeze(result);
  const entries = header.split(";", limit + 1);
  for (let index = 0; index < Math.min(entries.length, limit); index++) {
    const entry = entries[index]!;
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const name = entry.slice(0, separator).trim();
    try { result[name] = decodeURIComponent(entry.slice(separator + 1).trim()); } catch {}
  }
  return Object.freeze(result);
}
