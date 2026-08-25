import { mkdir } from "node:fs/promises";
import { resolveInside, atomicWrite, pathExists } from "../filesystem";
import { CLIError } from "../errors";
import { ExitCode } from "../types";
import { createStarterFiles } from "./starter-files";

/** Creates a secure current Warbler starter application. */
export async function createStarterProject(cwd: string, name: string | undefined, dryRun = false): Promise<string> {
  if (name === undefined || !/^[a-z][a-z0-9-]*$/u.test(name)) throw new CLIError("CLI5101", "Project name must be lowercase kebab-case.", ExitCode.INVALID_ARGUMENTS);
  const root = resolveInside(cwd, name);
  if (await pathExists(root)) throw new CLIError("CLI5102", `Project already exists: ${name}`, ExitCode.FILESYSTEM_FAILURE);
  if (dryRun) return root;
  await mkdir(root);
  for (const { path, content } of createStarterFiles({ name })) await atomicWrite(root, path, content);
  return root;
}
