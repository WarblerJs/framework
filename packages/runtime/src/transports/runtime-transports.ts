import type { RuntimeConfig, TransportName } from "@warblerjs/config";
import type { MaybePromise, TransportKindValue } from "@warblerjs/transport";
import {
  RuntimeConfigurationError,
  RuntimeError,
  RuntimeTransportError,
  TransportAlreadyRunningError,
  TransportDisabledError,
} from "../errors/runtime-errors";
import type { RuntimeGeneratedApplication, RuntimeRouteHandler, RuntimeSocketHandler } from "../generated/generated-types";
import type { RuntimeProviderContainers } from "../container/provider-container";

const TRANSPORTS = Object.freeze(["http", "websocket", "tcp", "udp", "mcp", "webrtc"] as const);

/** Generated execution structures shared with enabled transports. */
export interface RuntimeTransportContext {
  readonly generated: RuntimeGeneratedApplication;
  readonly routes: Readonly<Record<string, Readonly<Record<string, RuntimeRouteHandler>>>>;
  readonly socketDispatchers: Readonly<Record<number, Readonly<Record<string, RuntimeSocketHandler>>>>;
  readonly socketLifecycle: Readonly<Record<number, Readonly<Record<string, RuntimeSocketHandler>>>>;
  readonly providers: RuntimeProviderContainers;
}
/** Runtime-facing transport adapter contract. */
export interface RuntimeTransportAdapter {
  readonly kind: TransportKindValue;
  start(context: Readonly<{ config: Readonly<unknown>; transport: RuntimeTransportContext }>): MaybePromise<unknown>;
  stop(context: Readonly<{ native: unknown; transport: RuntimeTransportContext }>): MaybePromise<void>;
}
/** Lazy adapter importer invoked only for an enabled transport. */
export type RuntimeTransportLoader = () => RuntimeTransportAdapter | Promise<RuntimeTransportAdapter>;
/** Exact lazy transport loader map. */
export type RuntimeTransportLoaders = Readonly<Partial<Record<TransportName, RuntimeTransportLoader>>>;
/** Enabled transport configuration loader. */
export type RuntimeTransportConfigLoader =
  (transport: TransportName, runtime: RuntimeConfig, workspaceRoot: string) => Promise<Readonly<unknown> | undefined>;

interface RunningTransport {
  readonly adapter: RuntimeTransportAdapter;
  readonly native: unknown;
}

/** Starts and stops only enabled transports using direct keyed registrations. */
export class RuntimeTransportManager {
  readonly #loaders: RuntimeTransportLoaders;
  readonly #loadConfig: RuntimeTransportConfigLoader;
  readonly #workspaceRoot: string;
  readonly #context: RuntimeTransportContext;
  readonly #running = new Map<TransportName, RunningTransport>();
  readonly #order: TransportName[] = [];

  /** Creates an unstarted transport manager. */
  public constructor(
    loaders: RuntimeTransportLoaders,
    loadConfig: RuntimeTransportConfigLoader,
    workspaceRoot: string,
    context: RuntimeTransportContext,
  ) {
    this.#loaders = loaders;
    this.#loadConfig = loadConfig;
    this.#workspaceRoot = workspaceRoot;
    this.#context = context;
  }

  /** Starts each enabled transport exactly once. */
  public async startEnabled(runtime: RuntimeConfig): Promise<void> {
    for (const transport of TRANSPORTS) {
      if (!runtime.transports[transport].enabled) continue;
      if (this.#running.has(transport)) throw new TransportAlreadyRunningError(`Transport already running: ${transport}`);
      const loader = this.#loaders[transport];
      if (loader === undefined) throw new TransportDisabledError(`No adapter loader registered for enabled transport: ${transport}`);
      const adapter = await loader();
      if (adapter.kind !== transport) throw new RuntimeError(`Transport loader "${transport}" returned adapter "${adapter.kind}".`);
      let config: Readonly<unknown> | undefined;
      try {
        config = await this.#loadConfig(transport, runtime, this.#workspaceRoot);
      } catch (cause) {
        throw new RuntimeConfigurationError(`Unable to load configuration for transport "${transport}".`, { cause });
      }
      if (config === undefined) throw new RuntimeConfigurationError(`Enabled transport configuration missing: ${transport}`);
      let native: unknown;
      try {
        native = await adapter.start(Object.freeze({ config, transport: this.#context }));
      } catch (cause) {
        throw new RuntimeTransportError(`Transport "${transport}" failed to start.`, { cause });
      }
      if (native === undefined || native === null) throw new RuntimeError(`Transport "${transport}" returned an invalid handle.`);
      this.#running.set(transport, Object.freeze({ adapter, native }));
      this.#order.push(transport);
    }
  }

  /** Returns whether a transport is currently running. */
  public isRunning(transport: TransportName): boolean {
    return this.#running.has(transport);
  }

  /** Stops transports in reverse startup order. */
  public async stopAll(): Promise<void> {
    let failure: unknown;
    for (let index = this.#order.length - 1; index >= 0; index--) {
      const transport = this.#order[index]!;
      const running = this.#running.get(transport);
      if (running === undefined) continue;
      try {
        await running.adapter.stop(Object.freeze({ native: running.native, transport: this.#context }));
      } catch (cause) {
        failure ??= cause;
      } finally {
        this.#running.delete(transport);
      }
    }
    this.#order.length = 0;
    if (failure !== undefined) throw new RuntimeTransportError("One or more transports failed to stop.", { cause: failure });
  }
}
