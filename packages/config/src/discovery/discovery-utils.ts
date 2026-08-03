import { ConfigError } from "../errors";
import { joinPath } from "../utils/path";

export async function requireFile(path: string, description: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new ConfigError(`${description} does not exist`, path);
  return path;
}

export async function requireDirectory(path: string, description: string): Promise<string> {
  try {
    const glob = new Bun.Glob("*");
    for await (const _entry of glob.scan({ cwd: path, onlyFiles: false })) return path;
  } catch (error) {
    throw new ConfigError(`${description} does not exist`, path, { cause: error });
  }
  throw new ConfigError(`${description} is missing or empty`, path);
}

export function playgroundPath(workspaceRoot: string): string {
  return joinPath(workspaceRoot, "playground");
}
