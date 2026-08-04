export { CompiledCatalog, loadTranslationCatalog } from "./catalog";
export { normalizeI18nConfig, matchSupportedLocale } from "./config";
export { I18nError, I18nErrorCode, type I18nErrorCode as I18nErrorCodeType } from "./errors";
export { generateCatalogModule } from "./generator";
export {
  createRequestTranslation, createSocketTranslation, localizeRequest,
  type LocalizedRequest, type TranslationAccessor,
} from "./integration";
export { interpolate } from "./interpolation";
export { parseTranslationKey, type ParsedTranslationKey } from "./key";
export { canonicalizeLocale, parseAcceptLanguage, resolveLocale, resolveSupportedLocale } from "./locale";
export { loadProjectTranslator } from "./project";
export { CatalogTranslator, createTranslator } from "./translator";
export { createValidationMessage, parseValidationMessage, type ParsedValidationMessage } from "./validators";
export type {
  I18nConfig, I18nConfigInput, LocaleDetectionInput, LocaleDetectionSource,
  MissingTranslationBehavior, TranslationContext, TranslationParameter,
  TranslationParameters, Translator, ValidationMessage,
} from "./types";
