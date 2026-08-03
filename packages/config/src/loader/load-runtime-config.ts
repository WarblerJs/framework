import { discoverRuntimeConfig } from "../discovery";
import type { RuntimeConfig } from "../types";
import { normalizeRuntimeConfig } from "../normalize";
import { importConfig, selectExport } from "./module-loader";

/** Discovers, imports, validates, normalizes, and freezes runtime configuration. */
export async function loadRuntimeConfig(workspaceRoot = process.cwd()): Promise<RuntimeConfig> {
  const path = await discoverRuntimeConfig(workspaceRoot);
  const module = await importConfig(path);
  return normalizeRuntimeConfig(selectExport(module, ["runtimeConfig"], path));
}
