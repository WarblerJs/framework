import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { CLIError } from "../errors";
import { ExitCode } from "../types";

/** Resolves an untrusted relative path inside a trusted root. */
export function resolveInside(root: string, candidate: string, allowAbsolute = false): string {
  if (candidate.includes("\0")) throw new CLIError("CLI6001", "Path contains a null byte.", ExitCode.FILESYSTEM_FAILURE);
  if (isAbsolute(candidate) && !allowAbsolute) throw new CLIError("CLI6002", "Absolute output paths are not allowed.", ExitCode.FILESYSTEM_FAILURE);
  const target = resolve(root, candidate);
  const relation = relative(resolve(root), target);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new CLIError("CLI6003", "Path escapes the trusted project root.", ExitCode.FILESYSTEM_FAILURE);
  return target;
}

/** Rejects an existing symbolic-link output target. */
export async function rejectSymlink(path: string): Promise<void> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new CLIError("CLI6004", "Refusing to write through a symbolic link.", ExitCode.FILESYSTEM_FAILURE); }
  catch (cause) {
    if (cause instanceof CLIError) throw cause;
    if (isMissing(cause)) return;
    throw new CLIError("CLI6005", "Unable to inspect output path.", ExitCode.FILESYSTEM_FAILURE, undefined, { cause });
  }
}
/** Verifies an existing path resolves within a trusted root. */
export async function assertRealPathInside(root: string, path: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(path)]);
  const relation = relative(realRoot, realTarget);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new CLIError("CLI6006", "Resolved path escapes the trusted project root.", ExitCode.FILESYSTEM_FAILURE);
}
function isMissing(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}
