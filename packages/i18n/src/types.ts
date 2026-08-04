export type TranslationParameter = string | number | boolean | bigint | null;
export type TranslationParameters = Readonly<Record<string, TranslationParameter>>;
export type MissingTranslationBehavior = "key" | "fallback" | "error";
export type LocaleDetectionSource = "explicit" | "path" | "query" | "cookie" | "header";

export interface TranslationContext {
  readonly locale: string;
  readonly fallbackLocale: string;
  tr(key: string, parameters?: TranslationParameters): string;
  has(key: string): boolean;
}

export interface Translator {
  createContext(locale: string): TranslationContext;
  tr(locale: string, key: string, parameters?: TranslationParameters): string;
  has(locale: string, key: string): boolean;
}

export interface I18nConfig {
  readonly enabled: boolean;
  readonly defaultLocale: string;
  readonly fallbackLocale: string;
  readonly supportedLocales: readonly string[];
  readonly root: string;
  readonly detection: readonly LocaleDetectionSource[];
  readonly queryName: string;
  readonly cookieName: string;
  readonly headerName: string;
  readonly missingKey: MissingTranslationBehavior;
  readonly strictInterpolation: boolean;
}

export interface I18nConfigInput {
  readonly enabled?: boolean;
  readonly defaultLocale: string;
  readonly fallbackLocale?: string;
  readonly supportedLocales: readonly string[];
  readonly root?: string;
  readonly detection?: readonly LocaleDetectionSource[];
  readonly queryName?: string;
  readonly cookieName?: string;
  readonly headerName?: string;
  readonly missingKey?: MissingTranslationBehavior | Readonly<{ readonly behavior: MissingTranslationBehavior }>;
  readonly strictInterpolation?: boolean;
}

export interface LocaleDetectionInput {
  readonly explicit?: string;
  readonly url?: URL | string;
  readonly cookies?: Readonly<Record<string, string>>;
  readonly headers?: Headers | Readonly<Record<string, string | undefined>>;
}

export interface ValidationMessage {
  readonly key: string;
  readonly parameters: TranslationParameters;
}
