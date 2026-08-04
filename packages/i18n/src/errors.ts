export const I18nErrorCode = Object.freeze({
  INVALID_LOCALE: "I18N1001_INVALID_LOCALE",
  UNSUPPORTED_LOCALE: "I18N1002_UNSUPPORTED_LOCALE",
  INVALID_TRANSLATION_KEY: "I18N1003_INVALID_TRANSLATION_KEY",
  CATALOG_NOT_FOUND: "I18N1004_CATALOG_NOT_FOUND",
  TRANSLATION_NOT_FOUND: "I18N1005_TRANSLATION_NOT_FOUND",
  INVALID_CATALOG: "I18N1006_INVALID_CATALOG",
  INVALID_MESSAGE: "I18N1007_INVALID_MESSAGE",
  INTERPOLATION_FAILED: "I18N1008_INTERPOLATION_FAILED",
  PATH_ESCAPE_ATTEMPT: "I18N1009_PATH_ESCAPE_ATTEMPT",
  CONFIGURATION_INVALID: "I18N1010_CONFIGURATION_INVALID",
} as const);
export type I18nErrorCode = typeof I18nErrorCode[keyof typeof I18nErrorCode];

export class I18nError extends Error {
  public readonly code: I18nErrorCode;
  public constructor(code: I18nErrorCode, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "I18nError";
    this.code = code;
  }
}
