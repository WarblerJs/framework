import { realpath, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { I18nError, I18nErrorCode } from "./errors";
import { canonicalizeLocale } from "./locale";

const MAX_FILES_PER_LOCALE = 1_000;
const MAX_KEYS_PER_FILE = 10_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_KEY_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 64 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
type CatalogRecord = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Frozen, immutable translation snapshot with direct locale/catalog/key indexing. */
export class CompiledCatalog {
  readonly #records: Readonly<Record<string, CatalogRecord>>;
  public constructor(records: Readonly<Record<string, CatalogRecord>>) {
    this.#records = freezeCatalogRecords(records);
    Object.freeze(this);
  }
  public get(locale: string, catalog: string, key: string): string | undefined {
    return this.#records[locale]?.[catalog]?.[key];
  }
  public has(locale: string, catalog: string, key: string): boolean {
    return this.get(locale, catalog, key) !== undefined;
  }
  public locales(): readonly string[] { return Object.freeze(Object.keys(this.#records)); }
  public toJSON(): Readonly<Record<string, CatalogRecord>> { return this.#records; }
}

export async function loadTranslationCatalog(root: string, locales: readonly string[]): Promise<CompiledCatalog> {
  const rootPath = resolve(root);
  const rootReal = await safeRealpath(rootPath, I18nErrorCode.CATALOG_NOT_FOUND, "Translation catalog root was not found.");
  const result: Record<string, CatalogRecord> = Object.create(null);
  for (const requested of locales) {
    const locale = canonicalizeLocale(requested);
    const localePath = resolve(rootPath, locale);
    assertInside(rootPath, localePath);
    const localeReal = await safeRealpath(localePath, I18nErrorCode.CATALOG_NOT_FOUND, `Catalog for locale "${locale}" was not found.`);
    assertInside(rootReal, localeReal);
    result[locale] = await loadLocale(localeReal, rootReal);
  }
  return new CompiledCatalog(result);
}

async function loadLocale(localeRoot: string, globalRoot: string): Promise<CatalogRecord> {
  const files = await collectJson(localeRoot, globalRoot);
  const catalogs: Record<string, Readonly<Record<string, string>>> = Object.create(null);
  for (const file of files) {
    const name = relative(localeRoot, file).split(sep).join("/").replace(/\.json$/u, "");
    if (name.length === 0 || catalogs[name] !== undefined) invalidCatalog("Catalog namespace is invalid.");
    catalogs[name] = await readCatalogFile(file);
  }
  return freezeRecord(catalogs);
}

async function collectJson(directory: string, globalRoot: string): Promise<readonly string[]> {
  const result: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      const actual = await realpath(path);
      assertInside(globalRoot, actual);
      if (entry.isSymbolicLink()) {
        const details = await stat(actual);
        if (details.isDirectory()) pending.push(actual);
        else if (details.isFile() && actual.endsWith(".json")) result.push(actual);
      } else if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
      if (result.length > MAX_FILES_PER_LOCALE) invalidCatalog("Locale contains too many catalog files.");
    }
  }
  return Object.freeze(result.sort());
}

async function readCatalogFile(path: string): Promise<Readonly<Record<string, string>>> {
  const details = await stat(path);
  if (details.size > MAX_FILE_BYTES) invalidCatalog("Catalog file exceeds the size limit.");
  const source = await readFile(path, "utf8");
  rejectDetectableDuplicateKeys(source);
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (cause) { throw new I18nError(I18nErrorCode.INVALID_CATALOG, "Catalog contains invalid JSON.", { cause }); }
  if (!isRecord(parsed)) invalidCatalog("Catalog root must be a flat object.");
  const entries = Object.entries(parsed);
  if (entries.length > MAX_KEYS_PER_FILE) invalidCatalog("Catalog contains too many translations.");
  const messages: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH || FORBIDDEN_KEYS.has(key)) invalidCatalog("Catalog contains an invalid translation key.");
    if (typeof value !== "string" || value.length > MAX_MESSAGE_LENGTH) invalidCatalog("Catalog values must be strings within the message size limit.");
    messages[key] = value;
  }
  return freezeRecord(messages);
}

function rejectDetectableDuplicateKeys(source: string): void {
  const keys = new Set<string>();
  const matcher = /(?:^|[,{])\s*"((?:\\.|[^"\\])*)"\s*:/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) !== null) {
    let key: string;
    try { key = JSON.parse(`"${match[1]}"`) as string; } catch { continue; }
    if (keys.has(key)) invalidCatalog("Catalog contains duplicate translation keys.");
    keys.add(key);
  }
}
function freezeCatalogRecords(input: Readonly<Record<string, CatalogRecord>>): Readonly<Record<string, CatalogRecord>> {
  const locales: Record<string, CatalogRecord> = Object.create(null);
  for (const [locale, catalogs] of Object.entries(input)) {
    const frozen: Record<string, Readonly<Record<string, string>>> = Object.create(null);
    for (const [name, messages] of Object.entries(catalogs)) frozen[name] = freezeRecord(messages);
    locales[locale] = freezeRecord(frozen);
  }
  return freezeRecord(locales);
}
function freezeRecord<T>(value: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  const target: Record<string, T> = Object.create(null);
  for (const [key, item] of Object.entries(value)) target[key] = item;
  return Object.freeze(target);
}
function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new I18nError(I18nErrorCode.PATH_ESCAPE_ATTEMPT, "Catalog path escaped the configured translation root.");
}
async function safeRealpath(path: string, code: typeof I18nErrorCode.CATALOG_NOT_FOUND, message: string): Promise<string> {
  try { return await realpath(path); } catch (cause) { throw new I18nError(code, message, { cause }); }
}
function invalidCatalog(message: string): never { throw new I18nError(I18nErrorCode.INVALID_CATALOG, message); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
