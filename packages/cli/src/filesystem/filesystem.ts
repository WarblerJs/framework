import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CLIError } from "../errors";
import { ExitCode } from "../types";
import { assertRealPathInside, rejectSymlink, resolveInside } from "./safe-path";

/** Returns whether a path exists. */
export async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}
/** Reads and parses a JSON object. */
export async function readJson(path: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("JSON root must be an object");
    return value as Readonly<Record<string, unknown>>;
  } catch (cause) { throw new CLIError("CLI6007", `Unable to read JSON: ${path}`, ExitCode.FILESYSTEM_FAILURE, undefined, { cause }); }
}
/** Atomically writes a file inside a trusted root, respecting overwrite policy. */
export async function atomicWrite(root: string, relativePath: string, content: string, force = false): Promise<string> {
  const target = resolveInside(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await assertRealPathInside(root, dirname(target));
  await rejectSymlink(target);
  if (!force && await pathExists(target)) throw new CLIError("CLI6008", `File already exists: ${relativePath}`, ExitCode.FILESYSTEM_FAILURE, "Use --force to overwrite.");
  const temporary = `${target}.warbler-${crypto.randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { encoding: "utf8", flag: "wx" }); await rename(temporary, target); }
  catch (cause) { await rm(temporary, { force: true }).catch(() => {}); throw new CLIError("CLI6009", `Unable to write file: ${relativePath}`, ExitCode.FILESYSTEM_FAILURE, undefined, { cause }); }
  return target;
}
/** Copies a directory tree inside trusted source and destination roots. */
export async function copyTree(sourceRoot: string, sourceRelative: string, destinationRoot: string, destinationRelative: string): Promise<void> {
  const source = resolveInside(sourceRoot, sourceRelative);
  const destination = resolveInside(destinationRoot, destinationRelative);
  if (!await pathExists(source)) return;
  await assertRealPathInside(sourceRoot, source);
  await mkdir(dirname(destination), { recursive: true });
  await assertRealPathInside(destinationRoot, dirname(destination));
  await cp(source, destination, { recursive: true, errorOnExist: false, force: true });
}
/** Removes only `.warbler` or `dist` beneath a trusted project root. */
export async function removeGeneratedDirectory(projectRoot: string, name: ".warbler" | "dist"): Promise<void> {
  const target = resolveInside(projectRoot, name);
  await rejectSymlink(target);
  await rm(target, { recursive: true, force: true });
}
