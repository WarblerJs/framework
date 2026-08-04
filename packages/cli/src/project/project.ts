import { dirname, resolve } from "node:path";
import { access } from "node:fs/promises";
import { CLIError } from "../errors";
import { pathExists, readJson } from "../filesystem";
import { ExitCode } from "../types";

/** Validated Warbler project layout. */
export interface ProjectLayout {
  readonly root: string;
  readonly packageJson: string;
  readonly main: string;
  readonly runtimeConfig: string;
  readonly transportConfigDirectory: string;
  readonly tsconfig: string;
  readonly publicDirectory: string;
}
/** Locates a package root from an explicit path or by walking ancestors. */
export async function locateProject(cwd: string, explicit?: string): Promise<string> {
  let current = resolve(cwd, explicit ?? ".");
  if (explicit !== undefined && !await pathExists(current)) throw new CLIError("CLI2001", `Project path does not exist: ${explicit}`, ExitCode.INVALID_PROJECT);
  while (true) {
    if (await pathExists(resolve(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current || explicit !== undefined) break;
    current = parent;
  }
  throw new CLIError("CLI2002", "Warbler project package.json was not found.", ExitCode.INVALID_PROJECT);
}
/** Validates the required production project convention. */
export async function validateProject(root: string): Promise<ProjectLayout> {
  const layout: ProjectLayout = Object.freeze({
    root, packageJson: resolve(root, "package.json"), main: resolve(root, "src/main.ts"),
    runtimeConfig: resolve(root, "src/config/runtime.config.ts"),
    transportConfigDirectory: resolve(root, "src/config/transports"),
    tsconfig: resolve(root, "tsconfig.json"), publicDirectory: resolve(root, "public"),
  });
  const required = [
    [layout.packageJson, "package.json"], [layout.main, "src/main.ts"],
    [layout.runtimeConfig, "src/config/runtime.config.ts"], [layout.transportConfigDirectory, "src/config/transports"],
    [layout.tsconfig, "tsconfig.json"],
  ] as const;
  for (const [path, label] of required) if (!await pathExists(path)) throw new CLIError("CLI2003", `Required project path is missing: ${label}`, ExitCode.INVALID_PROJECT);
  const packageValue = await readJson(layout.packageJson);
  if (typeof packageValue.name !== "string" || packageValue.name.length === 0) throw new CLIError("CLI2004", "Project package.json requires a name.", ExitCode.INVALID_PROJECT);
  try { await access(root); } catch (cause) { throw new CLIError("CLI2005", "Project root is not accessible.", ExitCode.INVALID_PROJECT, undefined, { cause }); }
  return layout;
}
/** Reads a validated project package. */
export async function readProjectPackage(root: string): Promise<Readonly<Record<string, unknown>>> {
  return readJson(resolve(root, "package.json"));
}
