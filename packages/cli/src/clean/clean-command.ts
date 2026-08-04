import { removeGeneratedDirectory } from "../filesystem";
/** Removes only trusted CLI-generated build directories. */
export async function cleanCommand(projectRoot: string, dryRun = false): Promise<void> {
  if (dryRun) return;
  await removeGeneratedDirectory(projectRoot, ".warbler");
  await removeGeneratedDirectory(projectRoot, "dist");
}
