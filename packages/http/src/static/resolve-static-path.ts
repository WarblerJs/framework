import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { StaticFileError } from "../errors";

function decodePath(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 4; pass++) {
    let next: string;
    try { next = decodeURIComponent(decoded); } catch (error) {
      throw new StaticFileError("Malformed static path encoding", 400, { cause: error });
    }
    if (next === decoded) return next;
    decoded = next;
  }
  if (/%[0-9a-f]{2}/iu.test(decoded)) throw new StaticFileError("Excessively encoded static path", 400);
  return decoded;
}

/** Resolves and canonicalizes a static path while preventing traversal and symlink escape. */
export async function resolveStaticPath(root: string, requestPath: string): Promise<string> {
  if (requestPath.includes("\0")) throw new StaticFileError("Static path contains a null byte", 400);
  const decoded = decodePath(requestPath).replace(/\\/gu, "/");
  const segments = decoded.split("/");
  for (const segment of segments) {
    if (segment === ".." || segment === "." || segment.startsWith(".")) {
      throw new StaticFileError("Static path is not public", 403);
    }
  }
  const canonicalRoot = await realpath(root).catch((error: unknown) => {
    throw new StaticFileError("Static root is unavailable", 500, { cause: error });
  });
  const candidate = resolve(canonicalRoot, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const canonicalTarget = await realpath(candidate).catch((error: unknown) => {
    throw new StaticFileError("Static file was not found", 404, { cause: error });
  });
  const boundary = relative(canonicalRoot, canonicalTarget);
  if (boundary.startsWith(`..${sep}`) || boundary === ".." || isAbsolute(boundary)) {
    throw new StaticFileError("Static path escapes the public root", 403);
  }
  return canonicalTarget;
}
