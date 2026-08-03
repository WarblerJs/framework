import { playgroundPath, requireDirectory } from "./discovery-utils";

/** Discovers and verifies the conventional playground directory. */
export function discoverPlayground(workspaceRoot = process.cwd()): Promise<string> {
  return requireDirectory(playgroundPath(workspaceRoot), "playground directory");
}
