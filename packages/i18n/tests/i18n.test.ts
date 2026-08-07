import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CatalogTranslator, I18nError, canonicalizeLocale, createRequestTranslation,
  createTranslator, createValidationMessage, generateCatalogModule, interpolate,
  loadTranslationCatalog, localizeRequest, normalizeI18nConfig, parseAcceptLanguage,
  parseTranslationKey, parseValidationMessage, resolveLocale,
} from "../src";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-i18n-"));
  temporary.push(root);
  await Promise.all(["en/validators/auth", "fr"].map((path) => mkdir(join(root, path), { recursive: true })));
  await writeFile(join(root, "en/messages.json"), JSON.stringify({ welcome: "Welcome, :name!", max_message: "Maximum :allowed, entered :entered." }));
  await writeFile(join(root, "en/auth.json"), JSON.stringify({ failed: "Authentication failed." }));
  await writeFile(join(root, "en/validators/auth/messages.json"), JSON.stringify({ failed: "Invalid user." }));
  await writeFile(join(root, "fr/messages.json"), JSON.stringify({ welcome: "Bienvenue, :name!" }));
  return root;
}
function config(root: string, missingKey: "key" | "fallback" | "error" = "fallback") {
  return normalizeI18nConfig({ defaultLocale: "en", fallbackLocale: "en", supportedLocales: ["en", "fr"], root, missingKey });
}

describe("translation keys and interpolation", () => {
  test("resolves default, single, and nested catalog namespaces", () => {
    expect(parseTranslationKey("welcome")).toEqual({ catalog: "messages", key: "welcome" });
    expect(parseTranslationKey("auth.failed")).toEqual({ catalog: "auth", key: "failed" });
    expect(parseTranslationKey("validators.auth.messages.failed")).toEqual({ catalog: "validators/auth/messages", key: "failed" });
  });
  test("rejects traversal, separators, empty segments, controls, nulls, and encoded traversal", () => {
    for (const key of ["validators..failed", "../secret.password", "a/b.c", "a\\b.c", "a.\0b", "a.%2e%2e"]) {
      expect(() => parseTranslationKey(key)).toThrow(I18nError);
    }
  });
  test("interpolates primitive values once and supports strict missing parameters", () => {
    expect(interpolate(":text :count :ok :large :empty", { text: ":count", count: 2, ok: true, large: 3n, empty: null })).toBe(":count 2 true 3 ");
    expect(interpolate("Hello :name")).toBe("Hello :name");
    expect(() => interpolate("Hello :name", {}, true)).toThrow("I18N1008");
  });
});

describe("locale negotiation", () => {
  test("normalizes casing, exact locales, and base fallback", () => {
    expect(canonicalizeLocale("en-us")).toBe("en-US");
    expect(parseAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8", ["en", "fr"])).toBe("fr");
    expect(parseAcceptLanguage("en-US;q=0.7,fr;q=0.9", ["en", "fr"])).toBe("fr");
  });
  test("safely rejects malformed and oversized Accept-Language input", () => {
    expect(parseAcceptLanguage("xx;q=wat", ["en"])).toBeUndefined();
    expect(parseAcceptLanguage("en,".repeat(3_000), ["en"])).toBeUndefined();
  });
  test("uses configurable path, query, cookie, header, and defaults in order", async () => {
    const value = config(await fixture());
    expect(resolveLocale(value, { url: "https://x/fr/api?lang=en", cookies: { warbler_locale: "en" } })).toBe("fr");
    expect(resolveLocale(value, { url: "https://x/api?lang=fr" })).toBe("fr");
    expect(resolveLocale(value, { url: "https://x/api", headers: { "accept-language": "fr" } })).toBe("fr");
    expect(resolveLocale(value, { url: "https://x/api" })).toBe("en");
  });
});

describe("catalog loading and translation", () => {
  test("loads flat catalogs once with O(1) direct lookup and frozen snapshots", async () => {
    const root = await fixture();
    const catalog = await loadTranslationCatalog(root, ["en", "fr"]);
    expect(catalog.get("en", "auth", "failed")).toBe("Authentication failed.");
    expect(catalog.get("en", "validators/auth/messages", "failed")).toBe("Invalid user.");
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.toJSON())).toBe(true);
  });
  test("translates, interpolates, falls back, and handles missing behavior", async () => {
    const root = await fixture();
    const translator = await createTranslator(config(root));
    expect(translator.tr("fr", "welcome", { name: "Habib" })).toBe("Bienvenue, Habib!");
    expect(translator.tr("fr", "auth.failed")).toBe("Authentication failed.");
    expect(translator.has("fr", "auth.failed")).toBe(true);
    expect((await createTranslator(config(root, "key"))).tr("fr", "unknown")).toBe("unknown");
    expect(() => new CatalogTranslator(config(root, "error")).tr("en", "unknown")).toThrow("I18N1005");
  });
  test("atomically replaces active catalogs without replacing translator references", async () => {
    const root = await fixture();
    const translator = await createTranslator(config(root));
    const context = translator.createContext("en");
    await writeFile(join(root, "en/auth.json"), JSON.stringify({ failed: "Updated." }));
    await translator.reload();
    expect(context.tr("auth.failed")).toBe("Updated.");
  });
  test("rejects invalid roots, values, prototype keys, and escaping symlinks", async () => {
    const root = await fixture();
    await writeFile(join(root, "en/bad.json"), "[]");
    await expect(loadTranslationCatalog(root, ["en"])).rejects.toThrow("I18N1006");
    await rm(join(root, "en/bad.json"));
    await writeFile(join(root, "en/bad.json"), '{"count":1}');
    await expect(loadTranslationCatalog(root, ["en"])).rejects.toThrow("I18N1006");
    await writeFile(join(root, "en/bad.json"), '{"__proto__":"x"}');
    await expect(loadTranslationCatalog(root, ["en"])).rejects.toThrow("I18N1006");
    await writeFile(join(root, "en/bad.json"), '{"duplicate":"one","duplicate":"two"}');
    await expect(loadTranslationCatalog(root, ["en"])).rejects.toThrow("I18N1006");
    await rm(join(root, "en/bad.json"));
    const outside = await mkdtemp(join(tmpdir(), "warbler-outside-")); temporary.push(outside);
    await writeFile(join(outside, "secret.json"), '{"secret":"x"}');
    await symlink(join(outside, "secret.json"), join(root, "en/escape.json"));
    await expect(loadTranslationCatalog(root, ["en"])).rejects.toThrow("I18N1009");
  });
});

describe("integration contracts", () => {
  test("exposes a locale and stable request translator", async () => {
    const root = await fixture();
    const normalized = config(root);
    const translator = await createTranslator(normalized);
    const request = createRequestTranslation(translator, normalized, { url: "https://x/fr/profile" });
    expect(request.locale).toBe("fr");
    expect(request.tr("welcome", { name: "Habib" })).toBe("Bienvenue, Habib!");
  });
  test("augments a native request once while retaining identity and route parameters", async () => {
    const root = await fixture();
    const normalized = config(root);
    const translator = await createTranslator(normalized);
    const native = new Request("https://x/fr/profile?tag=one&tag=two", { headers: { cookie: "session=abc" } });
    Object.defineProperty(native, "params", { value: Object.freeze({ id: "10" }) });
    const request = localizeRequest(native, translator, normalized);
    expect(request === native).toBe(true);
    expect(request instanceof Request).toBe(true);
    expect(request.params.id).toBe("10");
    expect(request.query.tag).toEqual(["one", "two"]);
    expect(request.cookies).toBeInstanceOf(Bun.CookieMap);
    expect(request.cookies.get("session")).toBe("abc");
    expect(request.locale).toBe("fr");
    expect(request.tr("welcome", { name: "Habib" })).toBe("Bienvenue, Habib!");
    expect(localizeRequest(native, translator, normalized)).toBe(request);
  });
  test("creates structured validator message metadata from strict syntax", () => {
    expect(parseValidationMessage("max_message:allowed::entered")).toEqual({ key: "max_message", parameterNames: ["allowed", "entered"] });
    expect(createValidationMessage("max_message:allowed::entered", { allowed: 5, entered: 8 })).toEqual({ key: "max_message", parameters: { allowed: 5, entered: 8 } });
    for (const invalid of [":max", "message:", "message::entered", "message:../secret"]) expect(() => parseValidationMessage(invalid)).toThrow();
  });
  test("emits deterministic production modules", async () => {
    const catalog = await loadTranslationCatalog(await fixture(), ["en", "fr"]);
    expect(generateCatalogModule(catalog)).toBe(generateCatalogModule(catalog));
    expect(generateCatalogModule(catalog)).toContain("new CompiledCatalog");
  });
});
