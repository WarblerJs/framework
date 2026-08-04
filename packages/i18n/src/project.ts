import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeI18nConfig } from "./config";
import { createTranslator, type CatalogTranslator } from "./translator";
import type { I18nConfigInput } from "./types";

/** Loads the conventional project configuration and all catalogs exactly once. */
export async function loadProjectTranslator(workspaceRoot: string, build?: string): Promise<CatalogTranslator | undefined> {
  const configPath = resolve(workspaceRoot, "src/config/i18n.config.ts");
  try { if (!(await stat(configPath)).isFile()) return undefined; } catch { return undefined; }
  const url = pathToFileURL(configPath);
  if (build !== undefined) url.searchParams.set("build", build);
  const module: unknown = await import(url.href);
  const input = selectConfig(module);
  const configuredRoot = input.root ?? "resources/i18n";
  const normalized = normalizeI18nConfig({
    ...input,
    root: isAbsolute(configuredRoot) ? configuredRoot : resolve(workspaceRoot, configuredRoot),
  });
  return createTranslator(normalized);
}
function selectConfig(module: unknown): I18nConfigInput {
  if (typeof module !== "object" || module === null) throw new TypeError("i18n configuration module is invalid.");
  const value = "default" in module ? module.default : "i18nConfig" in module ? module.i18nConfig : undefined;
  if (typeof value !== "object" || value === null) throw new TypeError("i18n configuration export was not found.");
  return value as I18nConfigInput;
}
