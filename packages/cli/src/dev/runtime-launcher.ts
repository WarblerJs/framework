import type { CompilerContext } from "@warblerjs/compiler";
import type { RuntimeConfig, TransportName } from "@warblerjs/config";
import {
  startRuntime,
  type GeneratedApplicationBindings,
  type RuntimeHandle,
  type RuntimeTransportLauncher,
} from "@warblerjs/runtime";
import { pathToFileURL } from "node:url";
import { applyApplicationTransports, loadCLIConfig, loadEnabledTransportConfigs, resolveEnabledTransports } from "../config";
import { CLIError, describeErrorChain } from "../errors";
import { ExitCode } from "../types";
import type { DevelopmentReporter, DevelopmentRuntimeHandle, DevelopmentRuntimeLauncher, DevelopmentRuntimeOverrides } from "./dev-session";
import { resolveNetworkAddresses } from "./network-addresses";

const TRANSPORT_PACKAGES: Readonly<Record<TransportName, Readonly<{ packageName: string; factory: string }>>> = Object.freeze({
  http: Object.freeze({ packageName: "@warblerjs/http", factory: "createHttpRuntimeLauncher" }),
  websocket: Object.freeze({ packageName: "@warblerjs/websocket", factory: "createWebSocketRuntimeLauncher" }),
  tcp: Object.freeze({ packageName: "@warblerjs/tcp", factory: "createTcpRuntimeLauncher" }),
  udp: Object.freeze({ packageName: "@warblerjs/udp", factory: "createUdpRuntimeLauncher" }),
  mcp: Object.freeze({ packageName: "@warblerjs/mcp", factory: "createMcpRuntimeLauncher" }),
  webrtc: Object.freeze({ packageName: "@warblerjs/webrtc", factory: "createWebrtcRuntimeLauncher" }),
});

/** In-process launcher consuming only Compiler-generated bindings and Runtime public APIs. */
export class GeneratedBindingsRuntimeLauncher implements DevelopmentRuntimeLauncher {
  public async prepare(projectRoot: string, overrides: DevelopmentRuntimeOverrides = {}, report: DevelopmentReporter = () => {}): Promise<RuntimePreparation> {
    report(event("config", "started", "Loading Runtime configuration."));
    const runtimeConfig = applyOverrides(await loadCLIConfig(projectRoot), overrides);
    const enabledTransports = resolveEnabledTransports(runtimeConfig);
    report(event("config", "success", "Runtime configuration loaded."));
    report(event("transport", "started", "Loading enabled transport configurations.", { transports: enabledTransports }));
    const transportConfigs = await loadEnabledTransportConfigs(runtimeConfig, projectRoot);
    report(event("transport", "success", "Enabled transport configurations loaded.", { transports: enabledTransports }));
    return Object.freeze({ runtimeConfig, enabledTransports, transportConfigs });
  }
  public async start(projectRoot: string, compiler: CompilerContext, overrides: DevelopmentRuntimeOverrides = {}, report: DevelopmentReporter = () => {}, preparation?: unknown): Promise<DevelopmentRuntimeHandle> {
    if (compiler.applicationEntry === undefined || compiler.fingerprint === undefined) {
      throw new CLIError("CLI2003", "Compiler did not emit a generated application module.", ExitCode.FAILURE);
    }
    const prepared = isRuntimePreparation(preparation)
      ? preparation
      : await this.prepare(projectRoot, overrides, report);
    const runtimeConfig = applyApplicationTransports(prepared.runtimeConfig, compiler.applicationWIR?.transports);
    const enabledTransports = resolveEnabledTransports(runtimeConfig);
    const transportConfigs = runtimeConfig === prepared.runtimeConfig
      ? prepared.transportConfigs
      : await loadEnabledTransportConfigs(runtimeConfig, projectRoot);
    report(event("bindings", "started", `Importing ${compiler.applicationEntry}?build=${compiler.fingerprint}.`, {
      entry: compiler.applicationEntry,
      fingerprint: compiler.fingerprint,
    }));
    const application = await importGeneratedApplication(compiler.applicationEntry, compiler.fingerprint);
    report(event("bindings", "success", "Generated application bindings imported."));
    report(event("transport", "started", "Creating enabled Runtime transport launchers.", { transports: enabledTransports }));
    const transportLaunchers = await loadTransportLaunchers(enabledTransports, projectRoot);
    report(event("transport", "success", "Runtime transport launchers created.", { transports: enabledTransports }));
    let runtime: RuntimeHandle;
    try {
      report(event("runtime", "started", "Starting Runtime."));
      runtime = await startRuntime({
        application,
        runtimeConfig,
        transportLaunchers,
        development: true,
        workspaceRoot: projectRoot,
        transportConfigLoader: async (transport) => transportConfigs.get(transport),
      });
    } catch (cause) {
      report(event("runtime", "failure", describeErrorChain(cause)));
      throw new CLIError("CLI2006", "Runtime failed to start from generated application bindings.", ExitCode.RUNTIME_FAILURE, describeErrorChain(cause));
    }
    report(event("transport", "success", "Enabled transports are running.", {
      transports: runtime.transports.map((transport) => transport.kind),
    }));
    const portTransport = primaryPortTransport(enabledTransports);
    const network = portTransport === undefined
      ? undefined
      : resolveNetworkAddresses(runtimeConfig.network.host, runtimeConfig.transports[portTransport].port ?? 3000);
    return Object.freeze({
      ...(network === undefined ? {} : { network }),
      stop: () => runtime.stop({
        reason: "development-restart",
        closeActiveConnections: true,
        timeoutMs: 10_000,
      }),
    });
  }
}
interface RuntimePreparation {
  readonly runtimeConfig: RuntimeConfig;
  readonly enabledTransports: readonly TransportName[];
  readonly transportConfigs: ReadonlyMap<TransportName, Readonly<unknown>>;
}

/** Backward-compatible class name now backed by generated bindings rather than src/main.ts. */
export class ApplicationEntryRuntimeLauncher extends GeneratedBindingsRuntimeLauncher {}

/** Imports one cache-busted Compiler-generated application module. */
export async function importGeneratedApplication(entry: string, fingerprint: string): Promise<GeneratedApplicationBindings> {
  const url = pathToFileURL(entry);
  url.searchParams.set("build", fingerprint);
  let module: unknown;
  try { module = await import(url.href); }
  catch (cause) { throw new CLIError("CLI2003", "Generated application module could not be imported.", ExitCode.FAILURE, describeErrorChain(cause)); }
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
/** The transport whose port `--port`/the banner treat as "the" dev server port: HTTP if enabled, else WebSocket, else none. */
function primaryPortTransport(enabled: readonly TransportName[]): TransportName | undefined {
  return enabled.includes("http") ? "http" : enabled.includes("websocket") ? "websocket" : undefined;
}
function applyOverrides(config: RuntimeConfig, overrides: DevelopmentRuntimeOverrides): RuntimeConfig {
  const port = overrides.port === undefined ? undefined : Number(overrides.port);
  if (port !== undefined && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new CLIError("CLI1005", "Development port must be from 1 to 65535.", ExitCode.INVALID_ARGUMENTS);
  const enabled = resolveEnabledTransports(config);
  const portTransport = primaryPortTransport(enabled);
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
function isRuntimePreparation(value: unknown): value is RuntimePreparation {
  return typeof value === "object" && value !== null
    && "runtimeConfig" in value && typeof value.runtimeConfig === "object" && value.runtimeConfig !== null
    && "enabledTransports" in value && Array.isArray(value.enabledTransports)
    && "transportConfigs" in value && value.transportConfigs instanceof Map;
}
function event(
  stage: Parameters<DevelopmentReporter>[0]["stage"],
  status: Parameters<DevelopmentReporter>[0]["status"],
  message: string,
  metadata?: Readonly<Record<string, unknown>>,
): Parameters<DevelopmentReporter>[0] {
  return Object.freeze({ stage, status, message, ...(metadata === undefined ? {} : { metadata }) });
}
