import { removeGeneratedDirectory } from "../filesystem";
/** Removes only trusted CLI-generated build directories. */
export async function cleanCommand(projectRoot: string): Promise<void> {
  await removeGeneratedDirectory(projectRoot, ".warbler");
  await removeGeneratedDirectory(projectRoot, "dist");
}
