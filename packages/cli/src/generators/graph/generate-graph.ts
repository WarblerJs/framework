import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CLIError } from "../../errors";
import { atomicWrite, pathExists } from "../../filesystem";
import { ExitCode } from "../../types";
import { architecturePresets, DEFAULT_ARCHITECTURE } from "./architecture-registry";
import type { Architecture, GraphGenerationInput, GraphGenerationPlan, GraphGenerationResult, GraphTransport } from "./graph-generation.types";
import { normalizeGraphName } from "./naming";
import { DEFAULT_TRANSPORT, transportPresets } from "./transport-registry";

/** Generates a Warbler Graph feature boundary from typed architecture and transport presets. */
export async function generateGraph(input: GraphGenerationInput): Promise<GraphGenerationResult> {
  const plan = createGraphGenerationPlan(input);
  if (await pathExists(`${input.projectRoot}/${plan.rootDirectory}`)) {
    throw new CLIError("CLI5205", `Graph already exists: ${plan.rootDirectory}`, ExitCode.FILESYSTEM_FAILURE);
  }
  if (!input.dryRun) {
    for (const file of plan.files) {
      if (await pathExists(`${input.projectRoot}/${file.path}`)) {
        throw new CLIError("CLI5206", `Generated file already exists: ${file.path}`, ExitCode.FILESYSTEM_FAILURE);
      }
    }
    for (const directory of plan.directories) await mkdir(`${input.projectRoot}/${directory}`, { recursive: true });
    for (const file of plan.files) {
      await mkdir(`${input.projectRoot}/${dirname(file.path)}`, { recursive: true });
      await atomicWrite(input.projectRoot, file.path, file.content);
    }
  }
  return Object.freeze({
    graphName: plan.graphName,
    architecture: plan.architecture,
    transports: plan.transports,
    files: Object.freeze(plan.files.map((file) => file.path)),
    directories: plan.directories,
    dryRun: input.dryRun === true,
  });
}

/** Creates a deterministic Graph generation plan without touching the filesystem. */
export function createGraphGenerationPlan(input: GraphGenerationInput): GraphGenerationPlan {
  const name = normalizeGraphName(input.name);
  const architecture = resolveArchitecture(input.architecture);
  const transports = normalizeTransports(input.transports);
  const rootDirectory = `src/graphs/${name.directoryName}`;
  const transportDirectories = transports.flatMap((transport) => {
    const preset = transportPresets[transport];
    return [
      `${rootDirectory}/presentation/${preset.directory}`,
      ...preset.presentationDirectories.map((directory) => `${rootDirectory}/presentation/${preset.directory}/${directory}`),
    ];
  });
  const directories = Object.freeze([
    rootDirectory,
    ...transportDirectories,
    ...architecturePresets[architecture].layers.map((directory) => `${rootDirectory}/${directory}`),
  ]);
  const planBase = Object.freeze({
    graphName: name.routeNamePrefix,
    directoryName: name.directoryName,
    identifierBase: name.identifierBase,
    routePrefix: name.routePrefix,
    routeNamePrefix: name.routeNamePrefix,
    architecture,
    transports,
    rootDirectory,
    directories,
  });
  const files = Object.freeze(transports.flatMap((transport) => transportPresets[transport].renderFiles(planBase, transports.length)));
  return Object.freeze({ ...planBase, files });
}

export function resolveArchitecture(value: Architecture | undefined): Architecture {
  const architecture = value ?? DEFAULT_ARCHITECTURE;
  if (!(architecture in architecturePresets)) {
    throw new CLIError("CLI5202", `Unknown architecture: ${architecture}`, ExitCode.INVALID_ARGUMENTS);
  }
  return architecture;
}

export function normalizeTransports(values: readonly GraphTransport[] | undefined): readonly GraphTransport[] {
  const raw = values === undefined || values.length === 0 ? [DEFAULT_TRANSPORT] : values;
  const seen = new Set<string>();
  const normalized: GraphTransport[] = [];
  for (const value of raw) {
    const transport = value.trim().toLowerCase();
    if (transport.length === 0) throw new CLIError("CLI5203", "Transport list contains an empty transport.", ExitCode.INVALID_ARGUMENTS);
    if (!(transport in transportPresets)) throw new CLIError("CLI5203", `Unknown transport: ${transport}`, ExitCode.INVALID_ARGUMENTS);
    if (seen.has(transport)) throw new CLIError("CLI5204", `Duplicate transport: ${transport}`, ExitCode.INVALID_ARGUMENTS);
    seen.add(transport);
    normalized.push(transport as GraphTransport);
  }
  return Object.freeze(normalized);
}
