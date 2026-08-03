import { joinPath } from "../utils/path";
import { requireDirectory } from "./discovery-utils";
import { discoverPlayground } from "./discover-playground";

/** Discovers and verifies playground/src/config. */
export async function discoverConfigFolder(workspaceRoot = process.cwd()): Promise<string> {
  const playground = await discoverPlayground(workspaceRoot);
  return requireDirectory(joinPath(playground, "src", "config"), "configuration directory");
}
