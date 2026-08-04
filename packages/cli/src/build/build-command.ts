import { compileProject } from "@warbler/compiler";
import { mkdir } from "node:fs/promises";
import { loadCLIConfig, loadEnabledTransportConfigs, resolveEnabledTransports } from "../config";
import { CLIError } from "../errors";
import { atomicWrite, copyTree, removeGeneratedDirectory, resolveInside } from "../filesystem";
import type { ProjectLayout } from "../project";
import { ExitCode } from "../types";

/** Production build result. */
export interface BuildResult {
  readonly entry: string;
  readonly outDirectory: string;
  readonly manifest: string;
}
/** Compiles, bundles the real application entry, copies assets, and emits a deterministic manifest. */
export async function buildCommand(layout: ProjectLayout, options: Readonly<{ out?: string; minify?: boolean; sourcemap?: boolean }> = {}): Promise<BuildResult> {
  const runtime = await loadCLIConfig(layout.root);
  await loadEnabledTransportConfigs(runtime, layout.root);
  const compiler = await compileProject(layout.root);
  const errors = compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error");
  if (errors.length > 0) throw new CLIError("CLI2201", `Compilation failed with ${errors.length} error(s).`, ExitCode.FAILURE);
  const outRelative = options.out ?? "dist";
  const outDirectory = resolveInside(layout.root, outRelative);
  if (outRelative === "dist") await removeGeneratedDirectory(layout.root, "dist");
  await mkdir(outDirectory, { recursive: true });
  const generatedEntry = resolveInside(layout.root, ".warbler/generated/production.generated.ts");
  const result = await Bun.build({
    entrypoints: [generatedEntry], outdir: outDirectory, target: "bun",
    minify: options.minify ?? false, sourcemap: options.sourcemap ? "external" : "none",
    naming: "server.js",
    external: ["@warbler/*"],
  });
  if (!result.success) throw new CLIError("CLI2202", `Bun build failed: ${result.logs.map((log) => log.message).join("; ")}`, ExitCode.FAILURE);
  await copyTree(layout.root, "public", outDirectory, "public");
  const manifestValue = Object.freeze({
    version: 1,
    entry: "server.js",
    transports: resolveEnabledTransports(runtime),
    graphs: compiler.applicationWIR?.graphs.length ?? 0,
    generatedAt: "deterministic",
  });
  const manifest = await atomicWrite(outDirectory, ".warbler/build-manifest.json", `${JSON.stringify(manifestValue, null, 2)}\n`, true);
  const entry = resolveInside(outDirectory, "server.js");
  return Object.freeze({ entry, outDirectory, manifest });
}
