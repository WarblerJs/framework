import { CLIError } from "../errors";
import { generateGraph, type Architecture, type GraphTransport } from "../generators/graph";
import type { GraphGenerationResult } from "../generators/graph";
import { validateProject } from "../project";
import { ExitCode, type CLIContext } from "../types";

/** Runs the terminal-facing make:graph command after CLI parsing. */
export async function makeGraphCommand(context: CLIContext): Promise<GraphGenerationResult> {
  const root = context.projectRoot;
  if (root === undefined) throw new CLIError("CLI2002", "Warbler project package.json was not found.", ExitCode.INVALID_PROJECT);
  await validateProject(root);
  return generateGraph({
    projectRoot: root,
    name: context.args[0]!,
    ...(stringFlag(context.flags.architecture) === undefined ? {} : { architecture: stringFlag(context.flags.architecture)! as Architecture }),
    ...(stringFlag(context.flags.transport) === undefined ? {} : { transports: parseTransportFlag(stringFlag(context.flags.transport)!) }),
    dryRun: context.flags["dry-run"] === true,
  });
}

function parseTransportFlag(value: string): readonly GraphTransport[] {
  if (value.includes(" ") || value.includes("\t") || value.includes("\n")) {
    throw new CLIError("CLI5203", "Transport list must be comma-separated without whitespace.", ExitCode.INVALID_ARGUMENTS);
  }
  if (value.startsWith(",") || value.endsWith(",") || value.includes(",,")) {
    throw new CLIError("CLI5203", "Malformed transport list.", ExitCode.INVALID_ARGUMENTS);
  }
  return Object.freeze(value.split(",") as GraphTransport[]);
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
