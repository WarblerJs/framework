import { Console } from "@warblerjs/console";
import { CompiledCatalog, loadTranslationCatalog } from "./catalog";
import { I18nError, I18nErrorCode } from "./errors";
import { interpolate } from "./interpolation";
import { parseTranslationKey } from "./key";
import { resolveSupportedLocale } from "./locale";
import type { I18nConfig, TranslationContext, TranslationParameters, Translator } from "./types";

/** Atomic translator whose catalog snapshot can be replaced without changing request references. */
export class CatalogTranslator implements Translator {
  readonly #config: I18nConfig;
  #catalog: CompiledCatalog;
  readonly #warnings = new Set<string>();
  public constructor(config: I18nConfig, catalog: CompiledCatalog = new CompiledCatalog(Object.freeze({}))) {
    this.#config = config;
    this.#catalog = catalog;
  }
  public get config(): I18nConfig { return this.#config; }
  public get catalog(): CompiledCatalog { return this.#catalog; }
  public replaceCatalog(catalog: CompiledCatalog): void { this.#catalog = catalog; this.#warnings.clear(); }
  public async reload(): Promise<void> {
    if (!this.#config.enabled) return;
    this.replaceCatalog(await loadTranslationCatalog(this.#config.root, this.#config.supportedLocales));
  }
  public createContext(locale: string): TranslationContext {
    const selected = this.#locale(locale);
    const translator = this;
    return Object.freeze({
      locale: selected, fallbackLocale: this.#config.fallbackLocale,
      tr(key: string, parameters?: TranslationParameters) { return translator.tr(selected, key, parameters); },
      has(key: string) { return translator.has(selected, key); },
    });
  }
  public tr(locale: string, key: string, parameters?: TranslationParameters): string {
    const selected = this.#locale(locale);
    if (!this.#config.enabled) return key;
    const parsed = parseTranslationKey(key);
    let message = this.#catalog.get(selected, parsed.catalog, parsed.key);
    if (message === undefined && this.#config.missingKey === "fallback" && selected !== this.#config.fallbackLocale) {
      message = this.#catalog.get(this.#config.fallbackLocale, parsed.catalog, parsed.key);
    }
    if (message === undefined) {
      if (this.#config.missingKey === "error") throw new I18nError(I18nErrorCode.TRANSLATION_NOT_FOUND, `Translation "${key}" was not found for locale "${selected}".`);
      this.#warnMissing(selected, key);
      return key;
    }
    return interpolate(message, parameters, this.#config.strictInterpolation);
  }
  public has(locale: string, key: string): boolean {
    const selected = this.#locale(locale);
    if (!this.#config.enabled) return false;
    const parsed = parseTranslationKey(key);
    return this.#catalog.has(selected, parsed.catalog, parsed.key)
      || (this.#config.missingKey === "fallback" && this.#catalog.has(this.#config.fallbackLocale, parsed.catalog, parsed.key));
  }
  #locale(locale: string): string {
    const selected = resolveSupportedLocale(locale, this.#config.supportedLocales);
    if (selected === undefined) throw new I18nError(I18nErrorCode.UNSUPPORTED_LOCALE, "Locale is not supported.");
    return selected;
  }
  #warnMissing(locale: string, key: string): void {
    const id = `${locale}\0${key}`;
    if (this.#warnings.has(id)) return;
    this.#warnings.add(id);
    Console.warning("Missing translation.", { locale, key, fallback: this.#config.fallbackLocale });
  }
}

export async function createTranslator(config: I18nConfig): Promise<CatalogTranslator> {
  const catalog = config.enabled ? await loadTranslationCatalog(config.root, config.supportedLocales) : new CompiledCatalog(Object.freeze({}));
  return new CatalogTranslator(config, catalog);
}
