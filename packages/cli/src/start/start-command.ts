import type { ProjectLayout } from "../project";
import { CLIError } from "../errors";
import { pathExists, readJson, resolveInside } from "../filesystem";
import { ProcessOwner } from "../process/process-owner";
import { ExitCode } from "../types";

/** Runs an existing production build without compiling. */
export async function startCommand(layout: ProjectLayout, trailingArguments: readonly string[] = []): Promise<number> {
  const entry = resolveInside(layout.root, "dist/server.js");
  const manifest = resolveInside(layout.root, "dist/.warbler/build-manifest.json");
  if (!await pathExists(entry) || !await pathExists(manifest)) throw new CLIError("CLI2011", "Production build not found.", ExitCode.FAILURE, "Run: warbler build");
  const value = await readJson(manifest);
  if (
    value.entry !== "server.js" || value.version !== 1 ||
    typeof value.applicationFingerprint !== "string" ||
    !Array.isArray(value.enabledTransports) ||
    typeof value.sourceMap !== "boolean" ||
    typeof value.minified !== "boolean"
  ) throw new CLIError("CLI2012", "Production build manifest is invalid.", ExitCode.INVALID_PROJECT, "Run: warbler build");
  const owner = new ProcessOwner();
  owner.start(["bun", entry, ...trailingArguments], layout.root);
  return owner.wait();
}
