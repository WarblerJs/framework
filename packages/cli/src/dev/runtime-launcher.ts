import type { CompilerContext } from "@warbler/compiler";
import type { RuntimeConfig, TransportName } from "@warbler/config";
import {
  startRuntime,
  type GeneratedApplicationBindings,
  type RuntimeHandle,
  type RuntimeTransportLauncher,
} from "@warbler/runtime";
import { pathToFileURL } from "node:url";
import { loadCLIConfig, loadEnabledTransportConfigs, resolveEnabledTransports } from "../config";
import { CLIError } from "../errors";
import { ExitCode } from "../types";
import type { DevelopmentRuntimeHandle, DevelopmentRuntimeLauncher, DevelopmentRuntimeOverrides } from "./dev-session";

const TRANSPORT_PACKAGES: Readonly<Record<TransportName, Readonly<{ packageName: string; factory: string }>>> = Object.freeze({
  http: Object.freeze({ packageName: "@warbler/http", factory: "createHttpRuntimeLauncher" }),
  websocket: Object.freeze({ packageName: "@warbler/websocket", factory: "createWebSocketRuntimeLauncher" }),
  tcp: Object.freeze({ packageName: "@warbler/tcp", factory: "createTcpRuntimeLauncher" }),
  udp: Object.freeze({ packageName: "@warbler/udp", factory: "createUdpRuntimeLauncher" }),
  mcp: Object.freeze({ packageName: "@warbler/mcp", factory: "createMcpRuntimeLauncher" }),
  webrtc: Object.freeze({ packageName: "@warbler/webrtc", factory: "createWebrtcRuntimeLauncher" }),
});

/** In-process launcher consuming only Compiler-generated bindings and Runtime public APIs. */
export class GeneratedBindingsRuntimeLauncher implements DevelopmentRuntimeLauncher {
  public async start(projectRoot: string, compiler: CompilerContext, overrides: DevelopmentRuntimeOverrides = {}): Promise<DevelopmentRuntimeHandle> {
    if (compiler.applicationEntry === undefined || compiler.fingerprint === undefined) {
      throw new CLIError("CLI2003", "Compiler did not emit a generated application module.", ExitCode.FAILURE);
    }
    const runtimeConfig = applyOverrides(await loadCLIConfig(projectRoot), overrides);
    const transportConfigs = await loadEnabledTransportConfigs(runtimeConfig, projectRoot);
    const application = await importGeneratedApplication(compiler.applicationEntry, compiler.fingerprint);
    const transportLaunchers = await loadTransportLaunchers(resolveEnabledTransports(runtimeConfig), projectRoot);
    let runtime: RuntimeHandle;
    try {
      runtime = await startRuntime({
        application,
        runtimeConfig,
        transportLaunchers,
        development: true,
        workspaceRoot: projectRoot,
        transportConfigLoader: async (transport) => transportConfigs.get(transport),
      });
    } catch (cause) {
      throw new CLIError("CLI2006", "Runtime failed to start from generated application bindings.", ExitCode.RUNTIME_FAILURE, safeMessage(cause));
    }
    return Object.freeze({ stop: () => runtime.stop({ reason: "development-restart" }) });
  }
}

/** Backward-compatible class name now backed by generated bindings rather than src/main.ts. */
export class ApplicationEntryRuntimeLauncher extends GeneratedBindingsRuntimeLauncher {}

/** Imports one cache-busted Compiler-generated application module. */
export async function importGeneratedApplication(entry: string, fingerprint: string): Promise<GeneratedApplicationBindings> {
  const url = pathToFileURL(entry);
  url.searchParams.set("build", fingerprint);
  let module: unknown;
  try { module = await import(url.href); }
  catch (cause) { throw new CLIError("CLI2003", "Generated application module could not be imported.", ExitCode.FAILURE, safeMessage(cause)); }
  const candidate = generatedExport(module);
  if (!isGeneratedApplicationBindings(candidate)) throw new CLIError("CLI2004", "Generated application module has an invalid export.", ExitCode.FAILURE);
  return candidate;
}
/** Lazily imports only enabled transport launcher factories. */
export async function loadTransportLaunchers(transports: readonly TransportName[], projectRoot: string): Promise<readonly RuntimeTransportLauncher[]> {
  const launchers: RuntimeTransportLauncher[] = [];
  for (const transport of transports) {
    const descriptor = TRANSPORT_PACKAGES[transport];
    let module: unknown;
    try {
      const resolved = Bun.resolveSync(descriptor.packageName, projectRoot);
      module = await import(pathToFileURL(resolved).href);
    }
    catch {
      throw new CLIError(
        "CLI2008",
        `Enabled transport package is missing.\nTransport: ${transport}\nRequired package: ${descriptor.packageName}`,
        ExitCode.MISSING_DEPENDENCY,
      );
    }
    const factory = moduleValue(module, descriptor.factory);
    if (typeof factory !== "function") throw new CLIError("CLI2008", `Transport package does not export ${descriptor.factory}: ${descriptor.packageName}`, ExitCode.MISSING_DEPENDENCY);
    const launcher: unknown = factory();
    if (!isRuntimeTransportLauncher(launcher) || launcher.kind !== transport) throw new CLIError("CLI2008", `Transport launcher contract is invalid: ${descriptor.packageName}`, ExitCode.MISSING_DEPENDENCY);
    launchers.push(launcher);
  }
  return Object.freeze(launchers);
}
function applyOverrides(config: RuntimeConfig, overrides: DevelopmentRuntimeOverrides): RuntimeConfig {
  const port = overrides.port === undefined ? undefined : Number(overrides.port);
  if (port !== undefined && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new CLIError("CLI1005", "Development port must be from 1 to 65535.", ExitCode.INVALID_ARGUMENTS);
  const enabled = resolveEnabledTransports(config);
  const portTransport = enabled.includes("http") ? "http" : enabled.includes("websocket") ? "websocket" : undefined;
  const transports = Object.freeze(Object.fromEntries(Object.entries(config.transports).map(([name, value]) => [
    name,
    Object.freeze({
      ...value,
      ...(port !== undefined && name === portTransport ? { port } : {}),
      ...(overrides.mode !== undefined && name === "websocket" ? { mode: overrides.mode } : {}),
    }),
  ]))) as RuntimeConfig["transports"];
  return Object.freeze({
    ...config,
    network: Object.freeze({ ...config.network, ...(overrides.host === undefined ? {} : { host: overrides.host }) }),
    transports,
  });
}
function generatedExport(module: unknown): unknown {
  if (typeof module !== "object" || module === null) return undefined;
  if ("default" in module) return module.default;
  return "applicationBindings" in module ? module.applicationBindings : undefined;
}
function moduleValue(module: unknown, key: string): unknown {
  return typeof module === "object" && module !== null && key in module
    ? (module as Readonly<Record<string, unknown>>)[key]
    : undefined;
}
function isGeneratedApplicationBindings(value: unknown): value is GeneratedApplicationBindings {
  return typeof value === "object" && value !== null &&
    "application" in value && typeof value.application === "object" && value.application !== null &&
    "providers" in value && Array.isArray(value.providers) &&
    "controllers" in value && Array.isArray(value.controllers) &&
    "handlers" in value && Array.isArray(value.handlers);
}
function isRuntimeTransportLauncher(value: unknown): value is RuntimeTransportLauncher {
  return typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "string" && "start" in value && typeof value.start === "function";
}
function safeMessage(cause: unknown): string { return cause instanceof Error ? cause.message : "Unknown failure"; }
