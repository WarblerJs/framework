import { compileProject } from "@warblerjs/compiler";
import { Console, createCorrelationId } from "@warblerjs/console";
import { mkdir } from "node:fs/promises";
import { applyApplicationTransports, loadCLIConfig, loadEnabledTransportConfigs, resolveEnabledTransports } from "../config";
import { CLIError } from "../errors";
import { atomicWrite, copyTree, removeGeneratedDirectory, resolveInside } from "../filesystem";
import type { ProjectLayout } from "../project";
import { ExitCode } from "../types";
import type { TransportName } from "@warblerjs/config";
import { compileViewProject, type ViewProjectConfig } from "@warblerjs/view";
import { pathToFileURL } from "node:url";

/** Production build result. */
export interface BuildResult {
  readonly entry: string;
  readonly outDirectory: string;
  readonly manifest: string;
}
/** Compiles, bundles the real application entry, copies assets, and emits a deterministic manifest. */
export async function buildCommand(layout: ProjectLayout, options: Readonly<{ out?: string; minify?: boolean; sourcemap?: boolean }> = {}): Promise<BuildResult> {
  const timer = Console.timer("Build");
  const buildId = createCorrelationId("build");
  Console.build({ build: 1, buildId, status: "started" });
  const compiler = await compileProject(layout.root);
  const errors = compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error");
  if (errors.length > 0) throw new CLIError("CLI2201", `Compilation failed with ${errors.length} error(s).`, ExitCode.FAILURE);
  const runtime = applyApplicationTransports(await loadCLIConfig(layout.root), compiler.applicationWIR?.transports);
  await loadEnabledTransportConfigs(runtime, layout.root);
  const enabledTransports = resolveEnabledTransports(runtime);
  const outRelative = options.out ?? "dist";
  const outDirectory = resolveInside(layout.root, outRelative);
  if (outRelative === "dist") await removeGeneratedDirectory(layout.root, "dist");
  await mkdir(outDirectory, { recursive: true });
  if (compiler.applicationEntry === undefined || compiler.fingerprint === undefined) throw new CLIError("CLI2011", "Compiler production application entry is missing.", ExitCode.FAILURE);
  const viewConfig = await loadProductionViewConfig(layout.root);
  const viewArtifact = viewConfig !== undefined && viewConfig.enabled !== false
    ? (await compileViewProject({
      projectRoot: layout.root,
      config: viewConfig,
      mode: "production",
    })).artifact
    : Object.freeze({});
  await atomicWrite(
    layout.root,
    ".warbler/generated/view.generated.ts",
    `import { createCompiledViewArtifact } from "@warblerjs/view";\nexport const viewArtifact = createCompiledViewArtifact(${JSON.stringify(viewArtifact)});\n`,
    true,
  );
  const generatedEntry = await atomicWrite(
    layout.root,
    ".warbler/generated/production-entry.ts",
    productionEntrySource(enabledTransports),
    true,
  );
  const minified = options.minify ?? true;
  const sourceMap = options.sourcemap ?? true;
  const result = await Bun.build({
    entrypoints: [generatedEntry], outdir: outDirectory, target: "bun",
    minify: minified, sourcemap: sourceMap ? "external" : "none",
    naming: "server.js",
    external: ["@warblerjs/*"],
  });
  if (!result.success) throw new CLIError("CLI2202", `Bun build failed: ${result.logs.map((log) => log.message).join("; ")}`, ExitCode.FAILURE);
  await copyTree(layout.root, "public", outDirectory, "public");
  const manifestValue = Object.freeze({
    version: 1,
    frameworkVersion: "0.1.0",
    createdAt: "deterministic",
    entry: "server.js",
    transports: enabledTransports,
    enabledTransports,
    applicationFingerprint: compiler.fingerprint,
    sourceMap,
    minified,
    graphs: compiler.applicationWIR?.graphs.length ?? 0,
    generatedAt: "deterministic",
  });
  const manifest = await atomicWrite(outDirectory, ".warbler/build-manifest.json", `${JSON.stringify(manifestValue, null, 2)}\n`, true);
  const entry = resolveInside(outDirectory, "server.js");
  Console.build({ build: 1, buildId, status: "success", duration: timer.end() });
  return Object.freeze({ entry, outDirectory, manifest });
}

function productionEntrySource(transports: readonly TransportName[]): string {
  const descriptors: Readonly<Partial<Record<TransportName, Readonly<{ packageName: string; factory: string; configFile: string; exports: readonly string[] }>>>> = Object.freeze({
    http: Object.freeze({ packageName: "@warblerjs/http", factory: "createHttpRuntimeLauncher", configFile: "http.config", exports: Object.freeze(["httpConfig"]) }),
    websocket: Object.freeze({ packageName: "@warblerjs/websocket", factory: "createWebSocketRuntimeLauncher", configFile: "ws.config", exports: Object.freeze(["wsConfig", "websocketConfig"]) }),
  });
  const unsupported = transports.find((transport) => descriptors[transport] === undefined);
  if (unsupported !== undefined) throw new CLIError("CLI2008", `No production launcher is available for enabled transport: ${unsupported}`, ExitCode.MISSING_DEPENDENCY);
  const imports = transports.map((transport, index) => {
    const item = descriptors[transport]!;
    return `import { ${item.factory} } from ${JSON.stringify(item.packageName)};\nimport * as TransportConfig${index} from ${JSON.stringify(`../../src/config/transports/${item.configFile}`)};`;
  }).join("\n");
  const configs = transports.map((transport, index) => {
    const item = descriptors[transport]!;
    return `  ${JSON.stringify(transport)}: selectConfig(TransportConfig${index}, ${JSON.stringify(item.exports)}),`;
  }).join("\n");
  const launchers = transports.map((transport) => `${descriptors[transport]!.factory}()`).join(", ");
  return `/* Generated by @warblerjs/cli from Compiler and Runtime public contracts. */
import { installFatalErrorHandlers, startRuntime } from "@warblerjs/runtime";
import { activateCompiledViews } from "@warblerjs/view";
import application from "./application.generated";
import { viewArtifact } from "./view.generated";
import * as RuntimeConfigModule from "../../src/config/runtime.config";
${imports}
const selectConfig = (module: Readonly<Record<string, unknown>>, names: readonly string[]): unknown => {
  for (const name of names) if (name in module) return module[name];
  return module.default;
};
const runtimeConfig = selectConfig(RuntimeConfigModule, ["runtimeConfig"]);
const transportConfigs: Readonly<Record<string, unknown>> = Object.freeze({
${configs}
});
process.env.NODE_ENV ??= "production";
process.env.APP_ENV ??= process.env.NODE_ENV;
const shutdown = new AbortController();
activateCompiledViews(viewArtifact);
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const runtime = await startRuntime({
  application,
  runtimeConfig,
  transportLaunchers: [${launchers}],
  transportConfigLoader: async (transport) => transportConfigs[transport],
  signal: shutdown.signal,
});
// Last-resort safety net for a fatal error that escapes every per-request/per-connection
// exception boundary (HTTP/WebSocket/SSE all normalize and contain their own failures) —
// logs, gracefully stops the Runtime, then exits non-zero. Ordinary application errors
// never reach this; only genuinely unexpected process-level failures do.
installFatalErrorHandlers(runtime);
`;
}

async function loadProductionViewConfig(root: string): Promise<ViewProjectConfig | undefined> {
  const path = `${root}/src/config/view.ts`;
  if (!await Bun.file(path).exists()) return undefined;
  const loaded: unknown = await import(pathToFileURL(path).href);
  if (typeof loaded !== "object" || loaded === null) throw new CLIError("CLI2203", "View configuration module is invalid.", ExitCode.FAILURE);
  const module = loaded as Readonly<Record<string, unknown>>;
  const candidate = module["viewConfig"] ?? module["default"];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new CLIError("CLI2203", "View configuration must export viewConfig or a default object.", ExitCode.FAILURE);
  }
  return candidate as ViewProjectConfig;
}
