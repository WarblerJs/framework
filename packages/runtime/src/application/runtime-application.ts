import {
  loadRuntimeConfig as defaultRuntimeConfigLoader,
  loadTransportConfig as defaultTransportConfigLoader,
  type RuntimeConfig,
  type TransportName,
} from "@warbler/config";
import { RuntimeProviderContainers } from "../container/provider-container";
import { createRuntimeDiagnostic, type RuntimeDiagnostic } from "../diagnostics/runtime-diagnostic";
import {
  InvalidRuntimeStateError,
  RuntimeBootstrapError,
  RuntimeConfigurationError,
  RuntimeError,
  RuntimeShutdownError,
  RuntimeTransportError,
} from "../errors/runtime-errors";
import type { RuntimeGeneratedApplication, RuntimeRouteHandler, RuntimeSocketHandler } from "../generated/generated-types";
import { executeRuntimeHooks } from "../hooks/runtime-hooks";
import { loadGeneratedApplication } from "../loader/load-generated-application";
import { RuntimeState, type RuntimeStateValue } from "../state/runtime-state";
import { RuntimeTransportManager, type RuntimeTransportContext } from "../transports/runtime-transports";
import type { RuntimeOptions } from "./runtime-options";

/** Lightweight application Runtime over compiler-generated artifacts. */
export class RuntimeApplication {
  readonly #options: RuntimeOptions;
  readonly #diagnostics: RuntimeDiagnostic[] = [];
  #state: RuntimeStateValue = RuntimeState.CREATED;
  #generated: RuntimeGeneratedApplication | undefined;
  #configuration: RuntimeConfig | undefined;
  #providers: RuntimeProviderContainers | undefined;
  #transports: RuntimeTransportManager | undefined;
  #signalHandler: (() => void) | undefined;

  /** Creates a Runtime without loading configuration, artifacts, or transports. */
  public constructor(options: RuntimeOptions) {
    this.#options = Object.freeze({ ...options });
  }

  /** Current lifecycle state. */
  public get state(): RuntimeStateValue { return this.#state; }
  /** Loaded immutable generated application. */
  public get generated(): RuntimeGeneratedApplication | undefined { return this.#generated; }
  /** Loaded normalized Runtime configuration. */
  public get configuration(): RuntimeConfig | undefined { return this.#configuration; }
  /** Provider containers after successful artifact loading. */
  public get providers(): RuntimeProviderContainers | undefined { return this.#providers; }
  /** Immutable copy of collected Runtime diagnostics. */
  public get diagnostics(): readonly RuntimeDiagnostic[] { return Object.freeze([...this.#diagnostics]); }

  /** Bootstraps providers, configuration, hooks, and enabled transports exactly once. */
  public async bootstrap(): Promise<this> {
    if (this.#state !== RuntimeState.CREATED) throw new InvalidRuntimeStateError(`Cannot bootstrap Runtime from "${this.#state}".`);
    this.#state = RuntimeState.BOOTSTRAPPING;
    try {
      this.#generated = await loadGeneratedApplication(this.#options.generated);
      this.#providers = new RuntimeProviderContainers(
        this.#generated,
        this.#options.providerFactories,
        this.#options.providerDisposers,
      );
      const workspaceRoot = this.#options.workspaceRoot ?? process.cwd();
      try {
        this.#configuration = await (this.#options.runtimeConfigLoader ?? defaultRuntimeConfigLoader)(workspaceRoot);
      } catch (cause) {
        throw new RuntimeConfigurationError("Unable to load Runtime configuration.", { cause });
      }
      const routes = this.#generated.createRoutes(this.#options.routeHandlers);
      const socketDispatchers = this.#generated.createSocketDispatchers(this.#options.socketHandlers);
      const socketLifecycle = this.#generated.createSocketLifecycleHandlers?.(this.#options.socketHandlers) ?? Object.freeze({});
      const transportContext: RuntimeTransportContext = Object.freeze({
        generated: this.#generated, routes, socketDispatchers, socketLifecycle, providers: this.#providers,
      });
      this.#transports = new RuntimeTransportManager(
        this.#options.transportLoaders ?? Object.freeze({}),
        this.#options.transportConfigLoader ?? defaultRuntimeTransportConfigLoader,
        workspaceRoot,
        transportContext,
      );
      await this.#runHooks("start", this.#options.hooks?.onRuntimeStart);
      await this.#transports.startEnabled(this.#configuration);
      await this.#runHooks("ready", this.#options.hooks?.onRuntimeReady);
      if (this.#options.installSignalHandlers ?? true) this.#installSignals();
      this.#state = RuntimeState.RUNNING;
      return this;
    } catch (cause) {
      await this.#cleanupFailedBootstrap();
      this.#state = RuntimeState.STOPPED;
      const error = cause instanceof RuntimeError ? cause : new RuntimeBootstrapError("Runtime bootstrap failed.", { cause });
      this.#diagnostics.push(createRuntimeDiagnostic("WARBLER_RUNTIME_BOOTSTRAP", error.message, phaseFor(error)));
      throw error;
    }
  }

  /** Returns whether a transport is running without loading disabled transports. */
  public isTransportRunning(transport: TransportName): boolean {
    return this.#transports?.isRunning(transport) ?? false;
  }

  /** Gracefully stops hooks, transports, and providers. Repeated stopped calls are safe. */
  public async stop(): Promise<void> {
    if (this.#state === RuntimeState.STOPPED) return;
    if (this.#state !== RuntimeState.RUNNING) throw new InvalidRuntimeStateError(`Cannot stop Runtime from "${this.#state}".`);
    this.#state = RuntimeState.STOPPING;
    this.#removeSignals();
    let failure: unknown;
    try { await this.#runHooks("shutdown", this.#options.hooks?.onRuntimeShutdown); } catch (cause) { failure ??= cause; }
    try { await this.#transports?.stopAll(); } catch (cause) {
      this.#diagnostics.push(createRuntimeDiagnostic("WARBLER_RUNTIME_TRANSPORT_STOP", "Transport shutdown failed.", "shutdown"));
      failure ??= cause;
    }
    try { await this.#providers?.dispose(); } catch (cause) {
      this.#diagnostics.push(createRuntimeDiagnostic("WARBLER_RUNTIME_PROVIDER_DISPOSE", "Provider disposal failed.", "shutdown"));
      failure ??= cause;
    }
    this.#state = RuntimeState.STOPPED;
    if (failure !== undefined) throw new RuntimeShutdownError("Runtime shutdown completed with failures.", { cause: failure });
  }

  async #runHooks(phase: "start" | "ready" | "shutdown", hooks: readonly (() => void | Promise<void>)[] | undefined): Promise<void> {
    try { await executeRuntimeHooks(hooks); }
    catch (cause) {
      this.#diagnostics.push(createRuntimeDiagnostic("WARBLER_RUNTIME_HOOK", `Runtime ${phase} hook failed.`, "hook"));
      throw new RuntimeError(`Runtime ${phase} hook failed.`, { cause });
    }
  }

  async #cleanupFailedBootstrap(): Promise<void> {
    try { await this.#transports?.stopAll(); } catch {}
    try { await this.#providers?.dispose(); } catch {}
    this.#removeSignals();
  }

  #installSignals(): void {
    if (this.#signalHandler !== undefined) return;
    this.#signalHandler = (): void => { void this.stop().catch(() => {}); };
    process.on("SIGINT", this.#signalHandler);
    process.on("SIGTERM", this.#signalHandler);
  }
  #removeSignals(): void {
    if (this.#signalHandler === undefined) return;
    process.off("SIGINT", this.#signalHandler);
    process.off("SIGTERM", this.#signalHandler);
    this.#signalHandler = undefined;
  }
}

async function defaultRuntimeTransportConfigLoader(
  transport: TransportName,
  runtime: RuntimeConfig,
  workspaceRoot: string,
): Promise<Readonly<unknown> | undefined> {
  return defaultTransportConfigLoader(transport, runtime, workspaceRoot);
}
function phaseFor(error: RuntimeError): RuntimeDiagnostic["phase"] {
  if (error instanceof RuntimeConfigurationError) return "config";
  if (error instanceof RuntimeTransportError) return "transport";
  return "loader";
}
