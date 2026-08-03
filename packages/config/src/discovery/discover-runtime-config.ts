import { joinPath } from "../utils/path";
import { requireFile } from "./discovery-utils";
import { discoverConfigFolder } from "./discover-config-folder";

/** Discovers and verifies the conventional runtime configuration module. */
export async function discoverRuntimeConfig(workspaceRoot = process.cwd()): Promise<string> {
  const config = await discoverConfigFolder(workspaceRoot);
  return requireFile(joinPath(config, "runtime.config.ts"), "runtime configuration");
}
