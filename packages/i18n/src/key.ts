import { I18nError, I18nErrorCode } from "./errors";

const SEGMENT = /^[\p{L}\p{N}_-]{1,128}$/u;
export interface ParsedTranslationKey { readonly key: string; readonly catalog: string }

export function parseTranslationKey(value: string): ParsedTranslationKey {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || /[\u0000-\u001f\u007f/\\]/u.test(value)) invalid();
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { invalid(); }
  if (decoded !== value && /(?:\.\.|[/\\\u0000-\u001f\u007f])/u.test(decoded)) invalid();
  const segments = value.split(".");
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === "." || segment === "..")) invalid();
  const key = segments.at(-1)!;
  const catalog = segments.length === 1 ? "messages" : segments.slice(0, -1).join("/");
  return Object.freeze({ key, catalog });
}
function invalid(): never { throw new I18nError(I18nErrorCode.INVALID_TRANSLATION_KEY, "Translation key is invalid."); }
