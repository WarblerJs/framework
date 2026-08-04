export default {
  enabled: true,
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: ["en", "fr", "es", "ar"],
  root: "resources/i18n",
  detection: ["explicit", "path", "query", "cookie", "header"],
  queryName: "lang",
  cookieName: "warbler_locale",
  headerName: "accept-language",
  missingKey: "fallback",
} as const;
