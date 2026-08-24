# @warblerjs/i18n

Warbler's transport-neutral internationalization package. It loads and validates
flat JSON catalogs once, resolves request locales, and provides immutable
translation contexts with constant-time lookup.

```ts
const config = normalizeI18nConfig({
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: ["en", "fr"],
  root: "resources/i18n",
});
const translator = await createTranslator(config);
translator.tr("fr", "auth.failed");
```
