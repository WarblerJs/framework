import { I18nError, I18nErrorCode } from "./errors";
import { canonicalizeLocale } from "./locale";
import type { I18nConfig, I18nConfigInput, LocaleDetectionSource, MissingTranslationBehavior } from "./types";

const SOURCES = new Set<LocaleDetectionSource>(["explicit", "path", "query", "cookie", "header"]);
const BEHAVIORS = new Set<MissingTranslationBehavior>(["key", "fallback", "error"]);
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

export function normalizeI18nConfig(input: I18nConfigInput): I18nConfig {
  if (!isRecord(input) || !Array.isArray(input.supportedLocales) || input.supportedLocales.length === 0) invalid("supportedLocales must be a non-empty array.");
  const supported = [...new Set(input.supportedLocales.map(canonicalizeLocale))];
  const defaultLocale = matchSupportedLocale(canonicalizeLocale(input.defaultLocale), supported);
  const fallbackLocale = matchSupportedLocale(canonicalizeLocale(input.fallbackLocale ?? input.defaultLocale), supported);
  if (defaultLocale === undefined) invalid("defaultLocale must be supported.");
  if (fallbackLocale === undefined) invalid("fallbackLocale must be supported.");
  const detection = input.detection ?? ["explicit", "path", "query", "cookie", "header"];
  if (!Array.isArray(detection) || new Set(detection).size !== detection.length || detection.some((source) => !SOURCES.has(source))) invalid("detection contains an invalid or duplicate source.");
  const behavior = typeof input.missingKey === "object" && input.missingKey !== null ? input.missingKey.behavior : input.missingKey ?? "fallback";
  if (!BEHAVIORS.has(behavior)) invalid("missingKey is invalid.");
  const queryName = safeName(input.queryName ?? "lang", "queryName");
  const cookieName = safeName(input.cookieName ?? "warbler_locale", "cookieName");
  const headerName = safeName(input.headerName ?? "accept-language", "headerName").toLowerCase();
  return Object.freeze({
    enabled: input.enabled ?? true, defaultLocale, fallbackLocale,
    supportedLocales: Object.freeze(supported), root: input.root ?? "resources/i18n",
    detection: Object.freeze([...detection]), queryName, cookieName, headerName,
    missingKey: behavior, strictInterpolation: input.strictInterpolation ?? false,
  });
}

export function matchSupportedLocale(locale: string, supported: readonly string[]): string | undefined {
  const exact = supported.find((candidate) => candidate === locale);
  if (exact !== undefined) return exact;
  const base = locale.split("-")[0]!;
  return supported.find((candidate) => candidate === base);
}
function safeName(value: string, field: string): string {
  if (typeof value !== "string" || !SAFE_NAME.test(value)) invalid(`${field} is invalid.`);
  return value;
}
function invalid(message: string): never { throw new I18nError(I18nErrorCode.CONFIGURATION_INVALID, message); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
