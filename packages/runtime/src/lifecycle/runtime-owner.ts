import {
  loadRuntimeConfig,
  loadLoggingConfig,
  loadProfilingConfig,
  loadTransportConfig,
  normalizeRuntimeConfig,
  normalizeLoggingConfig,
  normalizeProfilingConfig,
  type LoggingConfig,
  type ProfilingConfig,
  type RuntimeConfig,
  type TransportName,
} from "@warbler/config";
import { Console } from "@warbler/console";
import { loadProjectTranslator, localizeRequest, type CatalogTranslator } from "@warbler/i18n";
import { getActiveContainer, RequestContextStore, runInRequestContext } from "@warbler/core";
import { validateApplicationBindings, type ValidatedBindingIndexes } from "../bindings";
import { RootProviderContainer, GraphProviderContainer, RequestProviderContainer } from "../container/generated-provider-containers";
import { ControllerInstanceTable } from "../controllers";
import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import {
  InvalidRuntimeStateError,
  RuntimeBootstrapError,
  RuntimeConfigurationError,
  RuntimeError,
  RuntimeShutdownError,
  RuntimeTransportError,
} from "../errors/runtime-errors";
import type { GeneratedApplicationBindings } from "../generated/executable-bindings";
import { createHttpHotPathProfiler, type HttpHotPathProfiler, type HttpProfileStage } from "../profiling/http-hot-path-profiler";
import {
  createGuardPipelineRegistry,
  createMiddlewarePipeline,
  executeHandler,
  executeValidator,
  linkGuardPipeline,
  type GuardPipelineRegistry,
} from "../pipelines";
import { RuntimeState, type RuntimeStateValue } from "../state/runtime-state";
import { TransportLauncherRegistry } from "../transports/transport-launcher-registry";
import type {
  RunningTransport,
  RuntimeExecutionContext,
  RuntimeTransportLauncher,
  RuntimeTransportStartInput,
  RuntimeTransportStopOptions,
} from "../transports/runtime-transport-launcher";
import { resolve } from "node:path";

const TRANSPORT_ORDER = Object.freeze(["http", "websocket", "tcp", "udp", "mcp", "webrtc"] as const);
type KnownTransport = (typeof TRANSPORT_ORDER)[number];
type TransportConfigLoader = (transport: TransportName, runtime: RuntimeConfig, workspaceRoot: string) => Promise<Readonly<unknown> | undefined>;

/** Graceful Runtime shutdown controls. */
export type RuntimeStopOptions = RuntimeTransportStopOptions;
/** Options accepted by the generated-binding production launcher. */
export interface StartRuntimeOptions {
  readonly application: GeneratedApplicationBindings;
  readonly runtimeConfig?: unknown;
  readonly transportLaunchers?: readonly RuntimeTransportLauncher[];
  readonly signal?: AbortSignal;
  readonly development?: boolean;
  readonly workspaceRoot?: string;
  readonly transportConfigLoader?: TransportConfigLoader;
}
/** Running generated application owner returned from startRuntime(). */
export interface RuntimeHandle {
  readonly state: RuntimeStateValue;
  readonly application: GeneratedApplicationBindings;
  readonly rootContainer: RootProviderContainer;
  readonly graphContainers: readonly GraphProviderContainer[];
  readonly transports: readonly RunningTransport[];
  stop(options?: RuntimeStopOptions): void | Promise<void>;
}
interface OwnedTransport {
  readonly launcher: RuntimeTransportLauncher;
  readonly running: RunningTransport;
}
interface HttpRouteExecutionPlan {
  readonly handlerId: number;
  readonly pipeline?: (input: unknown) => unknown;
  readonly minimal: boolean;
  readonly requestRequirements: number;
  readonly wrapAppRequest: boolean;
}
interface RuntimePipelineRegistry {
  readonly guard: GuardPipelineRegistry;
  readonly ranges: Map<string, readonly number[]>;
  readonly requestScopedGraphs: ReadonlySet<number>;
}
const COMPILER_ROUTE_VALIDATION = 1 << 7;
const COMPILER_ROUTE_MIDDLEWARE = 1 << 8;
const COMPILER_ROUTE_GUARD = 1 << 9;
const COMPILER_ROUTE_CSRF = 1 << 10;
const COMPILER_ROUTE_STREAMING = 1 << 11;
const COMPILER_ROUTE_VIEW_CONTEXT = 1 << 16;
const VALIDATOR_SOURCE_BODY = 1 << 0;
const VALIDATOR_SOURCE_QUERY = 1 << 1;
const VALIDATOR_SOURCE_PATH = 1 << 2;
const VALIDATOR_SOURCE_HEADERS = 1 << 3;
const VALIDATOR_SOURCE_COOKIES = 1 << 4;
const REQUEST_REQUIREMENT_NONE = 0;
const REQUEST_REQUIREMENT_BODY = 1 << 0;
const REQUEST_REQUIREMENT_QUERY = 1 << 1;
const REQUEST_REQUIREMENT_PARAMS = 1 << 2;
const REQUEST_REQUIREMENT_HEADERS = 1 << 3;
const REQUEST_REQUIREMENT_COOKIES = 1 << 4;
const REQUEST_REQUIREMENT_VALIDATION = 1 << 5;
const REQUEST_REQUIREMENT_APP_REQUEST = 1 << 6;
const REQUEST_REQUIREMENT_REQUEST_SCOPE = 1 << 7;
const EMPTY_RECORD: Readonly<Record<string, unknown>> = Object.freeze(Object.create(null) as Record<string, unknown>);
const DEFAULT_TRANSLATE = (key: string): string => key;
const UNSET_REQUEST_VALUE = Symbol("warbler.unsetRequestValue");
type RuntimeTranslate = (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => string;
interface HttpPipelineInput {
  readonly value: unknown;
  readonly query: unknown;
  readonly path: unknown;
  readonly headers: unknown;
  readonly cookies: unknown;
  readonly message: unknown;
  readonly metadata: unknown;
  readonly __request: Request;
  readonly __translate: RuntimeTranslate | undefined;
}

/** Owns one generated application from validation through graceful shutdown. */
export class GeneratedRuntimeOwner implements RuntimeHandle, RuntimeExecutionContext {
  readonly #options: StartRuntimeOptions;
  readonly #abortController = new AbortController();
  readonly #ownedTransports: OwnedTransport[] = [];
  readonly #graphMap = new Map<number, GraphProviderContainer>();
  #state: RuntimeStateValue = RuntimeState.CREATED;
  #indexes: ValidatedBindingIndexes | undefined;
  #root: RootProviderContainer | undefined;
  #graphs: readonly GraphProviderContainer[] = Object.freeze([]);
  #controllers: ControllerInstanceTable | undefined;
  #routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
  #socketPipelines: Readonly<Record<string, (input: unknown) => unknown>> = Object.freeze({});
  #abortListener: (() => void) | undefined;
  #stopPromise: Promise<void> | undefined;
  #translator: CatalogTranslator | undefined;
  #logging: LoggingConfig = normalizeLoggingConfig();
  #profiling: ProfilingConfig = normalizeProfilingConfig();
  #httpProfiler: HttpHotPathProfiler | undefined;

  public constructor(options: StartRuntimeOptions) { this.#options = Object.freeze({ ...options }); }
  public get state(): RuntimeStateValue { return this.#state; }
  public get application(): GeneratedApplicationBindings { return this.#options.application; }
  public get rootContainer(): RootProviderContainer {
    if (this.#root === undefined) throw new InvalidRuntimeStateError("Runtime Root container is not initialized.");
    return this.#root;
  }
  public get graphContainers(): readonly GraphProviderContainer[] { return this.#graphs; }
  public get transports(): readonly RunningTransport[] { return Object.freeze(this.#ownedTransports.map((item) => item.running)); }

  /** Validates, eagerly constructs, starts enabled transports, and reaches RUNNING. */
  public async start(): Promise<this> {
    this.#logging = await this.#loadLogging();
    configureDailyErrorLogging(this.#logging, this.#options.workspaceRoot ?? process.cwd());
    this.#profiling = await this.#loadProfiling();
    this.#httpProfiler = this.#profiling.http ? createHttpHotPathProfiler() : undefined;
    const timer = this.#logging.startup ? Console.timer("Runtime") : undefined;
    if (this.#logging.startup) Console.runtime("starting");
    this.#transition(RuntimeState.CREATED, RuntimeState.VALIDATING);
    try {
      this.#indexes = validateApplicationBindings(this.application);
      this.#state = RuntimeState.BOOTSTRAPPING;
      if (this.#logging.debug) Console.debug("Loading providers.");
      this.#root = new RootProviderContainer(this.#indexes.providers);
      const graphIds = Object.values(this.application.application.graphIds).sort((left, right) => left - right);
      this.#graphs = Object.freeze(graphIds.map((graphId) => {
        const container = new GraphProviderContainer(this.#indexes!.providers, graphId, this.#root!);
        this.#graphMap.set(graphId, container);
        return container;
      }));
      await this.#root.initialize();
      for (const graph of this.#graphs) await graph.initialize();
      if (this.#logging.debug) Console.debug("Providers loaded.", { root: this.application.providers.filter((provider) => provider.scope === "root").length });
      this.#controllers = new ControllerInstanceTable(this.#indexes.controllers, this.#graphMap);
      await this.#controllers.initialize();
      if (this.#logging.debug) Console.debug("Controllers and handlers loaded.", { controllers: this.application.controllers.length, handlers: this.application.handlers.length });
      this.#translator = await loadProjectTranslator(this.#options.workspaceRoot ?? process.cwd());
      this.#routes = this.#createHttpRoutes();
      this.#socketPipelines = this.#createSocketPipelines();
      const config = await this.#loadConfiguration();
      this.#state = RuntimeState.STARTING_TRANSPORTS;
      await this.#startTransports(config);
      if (this.#options.signal !== undefined) {
        this.#abortListener = (): void => { void this.stop({ reason: "abort" }); };
        this.#options.signal.addEventListener("abort", this.#abortListener, { once: true });
        if (this.#options.signal.aborted) {
          await this.stop({ reason: "abort" });
          return this;
        }
      }
      this.#state = RuntimeState.RUNNING;
      if (this.#logging.startup && timer !== undefined) Console.runtime("ready", { duration: timer.end(), transports: this.#ownedTransports.map((item) => item.running.kind) });
      return this;
    } catch (cause) {
      const duration = timer?.end();
      if (this.#logging.errors) Console.error("Runtime startup failed.", { ...(duration === undefined ? {} : { duration }), error: safeError(cause) });
      this.#state = RuntimeState.FAILED;
      await this.#rollback();
      if (cause instanceof RuntimeError) throw cause;
      throw new RuntimeBootstrapError("Generated Runtime startup failed.", { cause });
    }
  }
  /** Direct indexed provider lookup with Graph-to-Root fallback. */
  public resolveProvider(graphId: number, providerId: number): unknown {
    const graph = this.#graphMap.get(graphId);
    if (graph === undefined) throw new RuntimeBootstrapError(`Generated Graph container not found: ${graphId}`);
    return graph.resolve(providerId);
  }
  /** Direct indexed Handler execution against its startup-created Controller. */
  public invokeHandler(handlerId: number, input: readonly unknown[]): unknown {
    const binding = this.#indexes?.handlers[handlerId];
    if (binding === undefined || this.#controllers === undefined) throw new RuntimeBootstrapError(`Generated Handler not found: ${handlerId}`);
    return executeHandler(binding, binding.controllerId === undefined ? undefined : this.#controllers.get(binding.controllerId), handlerInput(binding, input));
  }
  /** Idempotently stops transports, Controllers, Graph providers, then Root providers. */
  public stop(options: RuntimeStopOptions = {}): Promise<void> {
    if (this.#state === RuntimeState.STOPPED) return Promise.resolve();
    if (this.#state === RuntimeState.STOPPING) return this.#stopPromise ?? Promise.resolve();
    if (this.#state !== RuntimeState.RUNNING && this.#state !== RuntimeState.FAILED && this.#state !== RuntimeState.STARTING_TRANSPORTS) {
      throw new InvalidRuntimeStateError(`${RuntimeDiagnosticCode.INVALID_STATE_TRANSITION}: Cannot stop Runtime from "${this.#state}".`);
    }
    this.#state = RuntimeState.STOPPING;
    this.#stopPromise = this.#performStop(options);
    return this.#stopPromise;
  }
  async #performStop(options: RuntimeStopOptions): Promise<void> {
    if (this.#logging.runtime) Console.runtime("stopping", { reason: sanitizeReason(options.reason) });
    this.#abortController.abort(sanitizeReason(options.reason));
    let failure: unknown;
    try { await withTimeout(this.#stopTransports(options), options.timeoutMs); } catch (cause) { failure ??= cause; }
    try { await this.#controllers?.dispose(); } catch (cause) { failure ??= cause; }
    for (let index = this.#graphs.length - 1; index >= 0; index--) {
      try { await this.#graphs[index]!.dispose(); } catch (cause) { failure ??= cause; }
    }
    try { await this.#root?.dispose(); } catch (cause) { failure ??= cause; }
    this.#removeAbortListener();
    this.#state = RuntimeState.STOPPED;
    if (this.#logging.runtime) Console.runtime("stopped");
    if (this.#profiling.summaryOnStop && this.#httpProfiler !== undefined) await Bun.write(Bun.stdout, this.#httpProfiler.summary());
    await Console.flushDailyFileLogger();
    if (failure !== undefined) throw new RuntimeShutdownError(`${RuntimeDiagnosticCode.SHUTDOWN_FAILED}: Runtime shutdown completed with failures.`, { cause: failure });
  }
  async #loadConfiguration(): Promise<RuntimeConfig> {
    try {
      return this.#options.runtimeConfig === undefined
        ? await loadRuntimeConfig(this.#options.workspaceRoot ?? process.cwd())
        : normalizeRuntimeConfig(this.#options.runtimeConfig);
    } catch (cause) {
      throw new RuntimeConfigurationError("Unable to load Runtime configuration.", { cause });
    }
  }
  async #loadLogging(): Promise<LoggingConfig> {
    try {
      return await loadLoggingConfig(this.#options.workspaceRoot ?? process.cwd());
    } catch {
      return normalizeLoggingConfig({ environment: this.#options.development === false ? "production" : "development" });
    }
  }
  async #loadProfiling(): Promise<ProfilingConfig> {
    try {
      return await loadProfilingConfig(this.#options.workspaceRoot ?? process.cwd());
    } catch {
      return normalizeProfilingConfig();
    }
  }
  async #startTransports(config: RuntimeConfig): Promise<void> {
    const registry = new TransportLauncherRegistry(this.#options.transportLaunchers ?? Object.freeze([]));
    const loadConfig = this.#options.transportConfigLoader ?? loadTransportConfig;
    for (const kind of TRANSPORT_ORDER) {
      if (!config.transports[kind].enabled) continue;
      const launcher = registry.get(kind);
      if (launcher === undefined) throw new RuntimeTransportError(`${RuntimeDiagnosticCode.TRANSPORT_LAUNCHER_MISSING}: No launcher registered for enabled transport "${kind}".`);
      const transportConfig = await loadConfig(kind, config, this.#options.workspaceRoot ?? process.cwd());
      if (transportConfig === undefined) throw new RuntimeConfigurationError(`Enabled transport configuration missing: ${kind}`);
      const input = Object.freeze({
        bindings: this.#transportBindings(kind),
        config: launcherConfiguration(kind, transportConfig, config, this.#options.development ?? false, this.#logging, this.#httpProfiler),
        runtime: this,
        signal: this.#abortController.signal,
      }) satisfies RuntimeTransportStartInput;
      try {
        if (this.#logging.transports && this.#logging.debug) Console.debug(`Starting ${kind} transport.`);
        const handle = await launcher.start(input);
        this.#ownedTransports.push(Object.freeze({ launcher, running: Object.freeze({ kind, handle }) }));
        if (this.#logging.transports && this.#logging.debug) Console.debug(`${kind} transport started.`);
      } catch (cause) {
        throw new RuntimeTransportError(`${RuntimeDiagnosticCode.TRANSPORT_START_FAILED}: Transport "${kind}" failed to start.`, { cause });
      }
    }
  }
  #transportBindings(kind: KnownTransport): unknown {
    if (kind === "http") return Object.freeze({
      routes: this.#routes,
      compiled: this.application.http,
      routeRecords: this.application.application.routeTable,
      strings: this.application.application.strings,
    });
    if (kind === "websocket") return Object.freeze({
      compiled: this.application.websocket,
      dispatch: (event: string, message: unknown, context: unknown): unknown => this.#executeSocket(event, message, context),
    });
    return undefined;
  }
  #createHttpRoutes(): Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> {
    const http = this.application.http;
    if (http === undefined) return Object.freeze({});
    const profiler = this.#httpProfiler;
    const registry = createRuntimePipelineRegistry(this.application.providers);
    const routeTable = this.application.application.routeTable;
    const plans = new Array<HttpRouteExecutionPlan>(routeTable.length);
    for (let index = 0, length = routeTable.length; index < length; index++) {
      plans[index] = this.#compileHttpRoutePlan(routeTable[index]!, registry, profiler);
    }
    if (profiler === undefined) {
      return http.createRoutes((routeId, request, validationInput) => {
        const plan = plans[routeId];
        if (plan === undefined) throw new RuntimeBootstrapError(`Generated HTTP route not found: ${routeId}`);
        if (plan.minimal) return normalizeHttpResult(this.invokeHandler(plan.handlerId, Object.freeze([])));
        const input = this.#translator === undefined
          ? request
          : localizeRequest(request, this.#translator, this.#translator.config);
        const pipelineInput = plan.wrapAppRequest || validationInput !== undefined
          ? httpPipelineInput(input, validationInput)
          : input;
        const result = plan.pipeline!(pipelineInput);
        return normalizeHttpResult(result);
      });
    }
    return http.createRoutes((routeId, request, validationInput) => {
      const routeStart = performance.now();
      const plan = plans[routeId];
      if (plan === undefined) throw new RuntimeBootstrapError(`Generated HTTP route not found: ${routeId}`);
      profiler.record("routeDispatch", performance.now() - routeStart);
      if (plan.minimal) return normalizeHttpResultProfiled(this.#invokeHandlerProfiled(plan.handlerId, Object.freeze([]), profiler), profiler);
      const contextStart = performance.now();
      const input = this.#translator === undefined
        ? request
        : localizeRequest(request, this.#translator, this.#translator.config);
      const pipelineInput = plan.wrapAppRequest || validationInput !== undefined
        ? httpPipelineInput(input, validationInput)
        : input;
      profiler.record("contextPreparation", performance.now() - contextStart);
      const result = plan.pipeline!(pipelineInput);
      return normalizeHttpResultProfiled(result, profiler);
    });
  }
  #compileHttpRoutePlan(record: Readonly<Record<string, unknown>>, registry: RuntimePipelineRegistry, profiler?: HttpHotPathProfiler): HttpRouteExecutionPlan {
    const handlerId = numberField(record, "handlerId");
    const validatorId = numberField(record, "validatorId");
    const controllerId = numberField(record, "controllerId");
    const flags = typeof record.flags === "number" ? record.flags : 0;
    const handler = this.#indexes?.handlers[handlerId];
    const validator = this.#indexes?.validators[validatorId];
    const parameterCount = typeof handler?.parameterCount === "number" ? handler.parameterCount : 1;
    const graphId = handler?.graphId ?? this.#indexes!.controllers[controllerId]?.graphId;
    if (graphId === undefined) throw new RuntimeBootstrapError(`Generated Controller has no Graph: ${controllerId}`);
    const hasRequestScoped = registry.requestScopedGraphs.has(graphId);
    const needsValidation = validatorId >= 0 || (flags & COMPILER_ROUTE_VALIDATION) !== 0;
    const needsMiddleware = (flags & COMPILER_ROUTE_MIDDLEWARE) !== 0 || numberField(record, "middlewareCount") > 0;
    const needsGuard = (flags & COMPILER_ROUTE_GUARD) !== 0 || numberField(record, "guardCount") > 0;
    const needsViewContext = (flags & (COMPILER_ROUTE_VIEW_CONTEXT | COMPILER_ROUTE_CSRF | COMPILER_ROUTE_STREAMING)) !== 0;
    const minimal = !needsValidation && !needsMiddleware && !needsGuard && !hasRequestScoped && !needsViewContext && parameterCount === 0;
    const usesCompiledValidatorShape = validatorId < 0 || typeof validator?.flags === "number";
    const requestRequirements = compileHttpRequestRequirements(validator?.flags, needsValidation, parameterCount > 0 || needsMiddleware || needsGuard, hasRequestScoped);
    return Object.freeze({
      handlerId,
      minimal,
      requestRequirements,
      wrapAppRequest: usesCompiledValidatorShape && (parameterCount > 0 || needsValidation || needsMiddleware || needsGuard || hasRequestScoped),
      ...(minimal ? {} : { pipeline: this.#compileRecordPipeline(record, registry, true, requestRequirements, undefined, profiler) }),
    });
  }
  #executeSocket(event: string, message: unknown, context: unknown): unknown {
    return this.#socketPipelines[event]?.(Object.freeze({ message, context }));
  }
  #createSocketPipelines(): Readonly<Record<string, (input: unknown) => unknown>> {
    const result: Record<string, (input: unknown) => unknown> = Object.create(null);
    const registry = createRuntimePipelineRegistry(this.application.providers);
    const events: Readonly<Record<string, Readonly<Record<string, unknown>>>> = this.application.websocket?.events ?? Object.freeze({});
    for (const [event, record] of Object.entries(events)) {
      result[event] = this.#compileRecordPipeline(record, registry, false, REQUEST_REQUIREMENT_NONE, event);
    }
    return Object.freeze(result);
  }
  #compileRecordPipeline(record: Readonly<Record<string, unknown>>, registry: RuntimePipelineRegistry, http: boolean, requestRequirements: number, socketEvent?: string, profiler?: HttpHotPathProfiler): (input: unknown) => unknown {
    const handlerId = numberField(record, "handlerId");
    const validatorId = numberField(record, "validatorId");
    const controllerId = numberField(record, "controllerId");
    const guardIds = linkedRange(registry, http ? "http:guard" : "socket:guard", record, "guardStart", "guardCount", http ? this.application.application.routeGuards : this.application.application.socketGuards);
    const middlewareIds = linkedRange(registry, http ? "http:middleware" : "socket:middleware", record, "middlewareStart", "middlewareCount", http ? this.application.application.routeMiddleware : this.application.application.socketMiddleware);
    const guardPipeline = linkGuardPipeline(this.#indexes!.guards, guardIds, registry.guard);
    // For HTTP, `context` is the request's RequestContextStore: guards/middleware may
    // still call `.set(...)` right up until this terminal step, so it's settled here —
    // right before the handler runs — rather than eagerly. `settle()` keeps its own
    // synchronous fast path when nothing async was set, matching `runValidated`'s.
    const handlerTerminal = (pipelineValue: unknown, context: unknown): unknown => {
      if (!http) return this.invokeHandler(handlerId, socketInputs(pipelineValue, socketEvent));
      if (profiler !== undefined) {
        const settleStart = performance.now();
        const settled = (context as RequestContextStore).settle();
        if (isThenable(settled)) {
          return settled.then(() => {
            profiler.record("requestContext", performance.now() - settleStart);
            return this.#invokeHandlerProfiled(handlerId, [pipelineValue], profiler);
          });
        }
        profiler.record("requestContext", performance.now() - settleStart);
        return this.#invokeHandlerProfiled(handlerId, [pipelineValue], profiler);
      }
      const settled = (context as RequestContextStore).settle();
      if (isThenable(settled)) return settled.then(() => this.invokeHandler(handlerId, [pipelineValue]));
      return this.invokeHandler(handlerId, [pipelineValue]);
    };
    const guardedTerminal = (pipelineValue: unknown, context: unknown): unknown => {
      const guardStart = profiler !== undefined && http ? performance.now() : 0;
      const guarded = guardPipeline.execute(pipelineValue, context);
      if (isThenable(guarded)) return guarded.then((allowed) => {
        if (profiler !== undefined && http) profiler.record("guardMiddleware", performance.now() - guardStart);
        if (allowed === true) return handlerTerminal(pipelineValue, context);
        if (allowed === false) return http ? forbidden() : undefined;
        return allowed;
      });
      if (profiler !== undefined && http) profiler.record("guardMiddleware", performance.now() - guardStart);
      if (guarded === true) return handlerTerminal(pipelineValue, context);
      if (guarded === false) return http ? forbidden() : undefined;
      return guarded;
    };
    const terminal = createMiddlewarePipeline(this.#indexes!.middleware, middlewareIds, guardedTerminal);
    const core = (input: unknown): unknown => {
      const validationInput = http ? input : socketValidationInput(input, socketEvent);
      const validator = this.#indexes!.validators[validatorId];
      return runValidated(validator, validationInput, (validated) => {
        const requestContextStart = profiler !== undefined && http ? performance.now() : 0;
        const requestContext = new RequestContextStore();
        const pipelineValue = http ? buildAppRequest(validationInput, validated, requestContext, requestRequirements) : socketValidatedEnvelope(input, validated);
        const pipelineContext = http ? requestContext : socketConnectionContext(pipelineValue);
        if (profiler !== undefined && http) profiler.record("requestContext", performance.now() - requestContextStart);
        return terminal(pipelineValue, pipelineContext);
    }, (outcome) => http ? invalidHttpValidation(validator, outcome.errors, validationInput, requestRequirements) : socketValidationFailure(input, outcome.errors), profiler !== undefined && http ? profiler : undefined);
    };
    // Route/socket pipelines run with the owning Graph as the ambient DI resolver so guards,
    // middleware, validators, and handlers can call `inject()` during execution. Only swap
    // in a fresh request-scoped container when the Graph actually declares request providers.
    const graphId = this.#indexes!.handlers[handlerId]?.graphId ?? this.#indexes!.controllers[controllerId]?.graphId;
    if (graphId === undefined) throw new RuntimeBootstrapError(`Generated Controller has no Graph: ${controllerId}`);
    const graph = this.#graphMap.get(graphId);
    if (graph === undefined) throw new RuntimeBootstrapError(`Generated Graph container not found: ${graphId}`);
    const hasRequestScoped = registry.requestScopedGraphs.has(graphId);
    if (hasRequestScoped) return (input: unknown): unknown => this.#runWithRequestScope(graph, graphId, () => core(input));
    return (input: unknown): unknown => runInRequestContext(graph, () => core(input));
  }
  #invokeHandlerProfiled(handlerId: number, input: readonly unknown[], profiler: HttpHotPathProfiler): unknown {
    const controllerStart = performance.now();
    const binding = this.#indexes?.handlers[handlerId];
    if (binding === undefined || this.#controllers === undefined) throw new RuntimeBootstrapError(`Generated Handler not found: ${handlerId}`);
    const controller = binding.controllerId === undefined ? undefined : this.#controllers.get(binding.controllerId);
    profiler.record("diController", performance.now() - controllerStart);
    const handlerStart = performance.now();
    const result = executeHandler(binding, controller, handlerInput(binding, input));
    if (isThenable(result)) {
      return result.then((value) => {
        profiler.record("handlerExecution", performance.now() - handlerStart);
        return value;
      });
    }
    profiler.record("handlerExecution", performance.now() - handlerStart);
    return result;
  }
  async #runWithRequestScope(graph: GraphProviderContainer, graphId: number, callback: () => unknown): Promise<unknown> {
    const requestContainer = new RequestProviderContainer(this.#indexes!.providers, graphId, graph);
    await requestContainer.initialize();
    try {
      return await runInRequestContext(requestContainer, callback);
    } finally {
      await requestContainer.dispose();
    }
  }
  async #stopTransports(options: RuntimeStopOptions): Promise<void> {
    let failure: unknown;
    for (let index = this.#ownedTransports.length - 1; index >= 0; index--) {
      const owned = this.#ownedTransports[index]!;
      const reason = sanitizeReason(options.reason);
      const stopOptions = Object.freeze({ ...options, ...(reason === undefined ? {} : { reason }) });
      try {
        if (this.#logging.transports && this.#logging.debug) Console.debug(`Stopping ${owned.running.kind} transport.`);
        await owned.launcher.stop?.(owned.running.handle, stopOptions);
        if (this.#logging.transports && this.#logging.debug) Console.debug(`${owned.running.kind} transport stopped.`);
      }
      catch (cause) { failure ??= cause; }
    }
    this.#ownedTransports.length = 0;
    if (failure !== undefined) throw new RuntimeTransportError("One or more generated transports failed to stop.", { cause: failure });
  }
  async #rollback(): Promise<void> {
    try { await this.#stopTransports({ reason: "startup-failure" }); } catch {}
    try { await this.#controllers?.dispose(); } catch {}
    for (let index = this.#graphs.length - 1; index >= 0; index--) try { await this.#graphs[index]!.dispose(); } catch {}
    try { await this.#root?.dispose(); } catch {}
    this.#removeAbortListener();
  }
  #removeAbortListener(): void {
    if (this.#options.signal !== undefined && this.#abortListener !== undefined) this.#options.signal.removeEventListener("abort", this.#abortListener);
    this.#abortListener = undefined;
  }
  #transition(expected: RuntimeStateValue, next: RuntimeStateValue): void {
    if (this.#state !== expected) throw new InvalidRuntimeStateError(`${RuntimeDiagnosticCode.INVALID_STATE_TRANSITION}: Expected "${expected}", received "${this.#state}".`);
    this.#state = next;
  }
}

/** Starts one Compiler-generated executable application manifest. */
export async function startRuntime(options: StartRuntimeOptions): Promise<RuntimeHandle> {
  return new GeneratedRuntimeOwner(options).start();
}
function handlerInput(binding: import("../generated/executable-bindings").HandlerBinding, input: readonly unknown[]): readonly unknown[] {
  const providerIds = binding.useCaseProviderIds;
  if (providerIds === undefined || providerIds.length === 0) return input;
  const keys = binding.useCaseKeys;
  if (keys === undefined || keys.length !== providerIds.length) throw new RuntimeBootstrapError(`Generated Handler use-case metadata is invalid: ${binding.id}`);
  const resolver = getActiveContainer() as unknown as { resolve(key: number): unknown };
  const useCases: Record<string, unknown> = Object.create(null);
  for (let index = 0, length = providerIds.length; index < length; index++) useCases[keys[index]!] = resolver.resolve(providerIds[index]!);
  const inputLength = input.length;
  const result = new Array<unknown>(inputLength + 1);
  for (let index = 0; index < inputLength; index++) result[index] = input[index];
  result[inputLength] = Object.freeze(useCases);
  return Object.freeze(result);
}
function runValidated(
  validator: import("../generated/executable-bindings").ValidatorBinding | undefined,
  input: unknown,
  terminal: (input: unknown) => unknown,
  onInvalid: (outcome: Readonly<{ valid: boolean; errors?: unknown }>) => unknown = () => invalidRequest(),
  profiler?: HttpHotPathProfiler,
): unknown {
  const startedAt = profiler === undefined ? 0 : performance.now();
  const result = executeValidator(validator, input);
  const successValue = (outcome: Readonly<{ value: unknown }>): unknown =>
    typeof validator?.flags === "number" ? outcome : validator === undefined ? unvalidatedValue(input, outcome.value) : outcome.value;
  if (isThenable(result)) return result.then((outcome) => {
    profiler?.record("validator", performance.now() - startedAt);
    return outcome.valid ? terminal(successValue(outcome)) : onInvalid(outcome);
  });
  profiler?.record("validator", performance.now() - startedAt);
  return result.valid ? terminal(successValue(result)) : onInvalid(result);
}
function httpPipelineInput(request: Request, validationInput: unknown): Readonly<Record<string, unknown>> {
  const source = typeof validationInput === "object" && validationInput !== null ? validationInput as Readonly<Record<string, unknown>> : EMPTY_RECORD;
  const localized = request as Request & Readonly<{ readonly tr?: unknown }>;
  const translate = typeof localized.tr === "function" ? localized.tr as RuntimeTranslate : undefined;
  return {
    value: source.value,
    query: source.query,
    path: source.path,
    headers: source.headers,
    cookies: source.cookies,
    message: source.message,
    metadata: source.metadata,
    __request: request,
    __translate: translate,
  } satisfies HttpPipelineInput;
}
function unvalidatedValue(input: unknown, value: unknown): unknown {
  return typeof input === "object" && input !== null && "__request" in input ? undefined : value;
}
function compileHttpRequestRequirements(validatorFlags: number | undefined, needsValidation: boolean, needsAppRequest: boolean, hasRequestScoped: boolean): number {
  let requirements = REQUEST_REQUIREMENT_NONE;
  if (needsValidation) requirements |= REQUEST_REQUIREMENT_VALIDATION;
  if (needsAppRequest) requirements |= REQUEST_REQUIREMENT_APP_REQUEST;
  if (hasRequestScoped) requirements |= REQUEST_REQUIREMENT_REQUEST_SCOPE;
  if (validatorFlags === undefined) return requirements;
  if ((validatorFlags & VALIDATOR_SOURCE_BODY) !== 0) requirements |= REQUEST_REQUIREMENT_BODY;
  if ((validatorFlags & VALIDATOR_SOURCE_QUERY) !== 0) requirements |= REQUEST_REQUIREMENT_QUERY;
  if ((validatorFlags & VALIDATOR_SOURCE_PATH) !== 0) requirements |= REQUEST_REQUIREMENT_PARAMS;
  if ((validatorFlags & VALIDATOR_SOURCE_HEADERS) !== 0) requirements |= REQUEST_REQUIREMENT_HEADERS;
  if ((validatorFlags & VALIDATOR_SOURCE_COOKIES) !== 0) requirements |= REQUEST_REQUIREMENT_COOKIES;
  return requirements;
}
function createRuntimePipelineRegistry(providers: readonly import("../generated/executable-bindings").ProviderBinding[]): RuntimePipelineRegistry {
  return {
    guard: createGuardPipelineRegistry(),
    ranges: new Map(),
    requestScopedGraphs: requestScopedGraphSet(providers),
  };
}
function requestScopedGraphSet(providers: readonly import("../generated/executable-bindings").ProviderBinding[]): ReadonlySet<number> {
  const graphs = new Set<number>();
  for (let index = 0, length = providers.length; index < length; index++) {
    const provider = providers[index]!;
    if (provider.scope === "request" && typeof provider.graphId === "number") graphs.add(provider.graphId);
  }
  return graphs;
}
function linkedRange(
  registry: RuntimePipelineRegistry,
  namespace: string,
  record: Readonly<Record<string, unknown>>,
  startKey: string,
  countKey: string,
  values: readonly number[] | undefined,
): readonly number[] {
  const start = numberField(record, startKey);
  const count = numberField(record, countKey);
  if (count === 0) return EMPTY_NUMBER_ARRAY;
  const key = rangeKey(namespace, values!, start, count);
  const existing = registry.ranges.get(key);
  if (existing !== undefined) return existing;
  const result = new Array<number>(count);
  for (let index = 0; index < count; index++) result[index] = values![start + index]!;
  const linked = Object.freeze(result);
  registry.ranges.set(key, linked);
  return linked;
}
const EMPTY_NUMBER_ARRAY: readonly number[] = Object.freeze([]);
function rangeKey(namespace: string, values: readonly number[], start: number, count: number): string {
  let key = namespace;
  for (let index = 0; index < count; index++) key += `:${values[start + index]!}`;
  return key;
}
function numberField(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new RuntimeBootstrapError(`Generated field "${key}" is invalid.`);
  return value;
}
function socketInputs(value: unknown, event?: string): readonly unknown[] {
  if (typeof value === "object" && value !== null && "message" in value && "context" in value) {
    if (event === "open" || event === "drain" || event === "close") return [value.context];
    return [value.message, value.context];
  }
  return [value];
}
function socketValidationInput(value: unknown, event?: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || !("message" in value)) return Object.freeze({ value: undefined, metadata: Object.freeze({ event }) });
  const message = value.message;
  const data = typeof message === "object" && message !== null && "data" in message ? message.data : undefined;
  return Object.freeze({ value: data, metadata: Object.freeze({ event }) });
}
function socketValidatedEnvelope(original: unknown, validated: unknown): unknown {
  if (typeof original !== "object" || original === null || !("message" in original) || !("context" in original)) return original;
  const message = original.message;
  if (typeof message !== "object" || message === null) return original;
  const data = validationOutcomeValue(validated);
  return Object.freeze({
    message: Object.freeze({ ...message, data }),
    context: original.context,
  });
}
/**
 * Builds the `AppRequest`-shaped object passed to every HTTP controller handler —
 * unconditionally, whether or not the route declared a validator (previously this
 * only ran for validated routes; unvalidated routes fell through to the raw native
 * `Request`, missing `.body`/`.native` despite being typed as `AppRequest`).
 *
 * `headers` is always the real native `Headers` — never the plain record `headerRules`
 * validation produces internally, which stays a pass/fail gate, not a value swap.
 * `cookies` is always a `Bun.CookieMap`, likewise never replaced by validated output.
 * `context` is a live getter into `requestContext`: mutable while guards/middleware
 * run, frozen once the pipeline's `settle()` step completes, but always the same
 * object identity end to end.
 */
function buildAppRequest(validationInput: unknown, body: unknown, requestContext: RequestContextStore, requestRequirements: number): unknown {
  if (typeof validationInput !== "object" || validationInput === null || !("__request" in validationInput)) return body;
  const request = validationInput.__request;
  if (!(request instanceof Request)) return body;
  const source = request as Request & Readonly<Record<string, unknown>>;
  const pipelineInput = validationInput as Readonly<Record<string, unknown>>;
  const outcome = validationOutcome(body);
  const bodyValue = outcome?.value ?? body;
  let paramsValue: unknown = outcome?.path ?? pipelineInput.path ?? source.params ?? UNSET_REQUEST_VALUE;
  let queryValue: unknown = outcome?.query ?? pipelineInput.query ?? source.query ?? UNSET_REQUEST_VALUE;
  const cookiesRequired = (requestRequirements & REQUEST_REQUIREMENT_COOKIES) !== 0;
  let cookiesValue: Bun.CookieMap | typeof UNSET_REQUEST_VALUE = UNSET_REQUEST_VALUE;
  return {
    native: request,
    body: bodyValue,
    get params(): unknown {
      if (paramsValue === UNSET_REQUEST_VALUE) paramsValue = source.params ?? EMPTY_RECORD;
      return paramsValue;
    },
    get query(): unknown {
      if (queryValue === UNSET_REQUEST_VALUE) queryValue = lazyRequestQuery(request);
      return queryValue;
    },
    headers: request.headers,
    get cookies(): Bun.CookieMap {
      if (cookiesValue === UNSET_REQUEST_VALUE) cookiesValue = cookiesRequired && source.cookies instanceof Bun.CookieMap ? source.cookies : requestCookieMap(request);
      return cookiesValue;
    },
    get context(): Readonly<Record<string, unknown>> { return requestContext.currentView(); },
    locale: typeof source.locale === "string" ? source.locale : "en",
    tr: typeof pipelineInput.__translate === "function" ? pipelineInput.__translate as RuntimeTranslate : DEFAULT_TRANSLATE,
  };
}
/**
 * Reuses `BunRequest.cookies` when present (already lazily parsed by Bun for every
 * request served through `Bun.serve({ routes })`); falls back to explicit
 * construction otherwise (plain `Request`, e.g. in tests). Duplicated in miniature
 * from `@warbler/http`'s `requestCookieMap` rather than imported from it: the
 * Runtime deliberately has no dependency on the HTTP package, since it also drives
 * WebSocket dispatch — `buildAppRequest` above structurally mirrors `AppRequest`
 * for the same reason, without importing the type itself.
 */
function requestCookieMap(request: Request): Bun.CookieMap {
  const native = request as Request & { readonly cookies?: unknown };
  if (native.cookies instanceof Bun.CookieMap) return native.cookies;
  return new Bun.CookieMap(request.headers.get("cookie") ?? "");
}
function lazyRequestQuery(request: Request): Readonly<Record<string, string | readonly string[]>> {
  const output: Record<string, string | readonly string[]> = Object.create(null);
  const parameters = new URL(request.url).searchParams;
  for (const [key, value] of parameters) {
    const current = output[key];
    if (current === undefined) output[key] = value;
    else if (typeof current === "string") output[key] = Object.freeze([current, value]);
    else output[key] = Object.freeze([...current, value]);
  }
  return Object.freeze(output);
}
function socketConnectionContext(pipelineValue: unknown): unknown {
  return typeof pipelineValue === "object" && pipelineValue !== null && "context" in pipelineValue ? pipelineValue.context : undefined;
}
function validationOutcome(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && "valid" in value && value.valid === true && "value" in value
    ? value
    : undefined;
}
function validationOutcomeValue(value: unknown): unknown { return validationOutcome(value)?.value ?? value; }
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
function forbidden(): Response { return new Response("Forbidden", { status: 403 }); }
function invalidRequest(): Response { return new Response("Invalid request", { status: 400 }); }
/**
 * Runs a validator's `onValidationError` handler, if one was compiled onto the binding,
 * against the raw (un-validated) request; otherwise falls back to the default JSON
 * validation-error response. The handler's return value flows straight back through the
 * same `normalizeHttpResult` check every controller result already passes through, and a
 * throw/rejection is left to propagate exactly like a controller throwing — no separate
 * error handling is introduced here.
 */
function invalidHttpValidation(
  validator: import("../generated/executable-bindings").ValidatorBinding | undefined,
  rawErrors: unknown,
  validationInput: unknown,
  requestRequirements: number,
): unknown {
  const handler = validator?.onValidationError;
  if (typeof handler !== "function") return invalidValidationResponse(rawErrors, validationInput);
  const req = buildAppRequest(validationInput, rawRequestValue(validationInput), new RequestContextStore(), requestRequirements);
  return (handler as (req: unknown, errors: unknown) => unknown)(req, rawErrors);
}
function rawRequestValue(validationInput: unknown): unknown {
  return typeof validationInput === "object" && validationInput !== null && "value" in validationInput
    ? (validationInput as Readonly<Record<string, unknown>>).value
    : undefined;
}
function invalidValidationResponse(rawErrors: unknown, input: unknown): Response {
  const errors = validationErrors(rawErrors);
  const translate = translatorFromInput(input);
  const output: Record<string, string> = Object.create(null);
  for (const [group, issues] of Object.entries(errors)) {
    const issue = issues[0];
    if (issue === undefined) continue;
    const field = group.includes(".") ? group.slice(group.indexOf(".") + 1) : group;
    output[field] = translate(issue.key, issue.parameters);
  }
  return Response.json(output, { status: 400 });
}
function socketValidationFailure(input: unknown, rawErrors: unknown): undefined {
  if (typeof input !== "object" || input === null || !("context" in input)) return undefined;
  const context = input.context;
  if (typeof context !== "object" || context === null || !("send" in context) || typeof context.send !== "function") return undefined;
  const translate = "tr" in context && typeof context.tr === "function"
    ? ((socketTranslate) => (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => socketTranslate(key, parameters))(context.tr as (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => string)
    : (key: string) => key;
  const data: Record<string, string> = Object.create(null);
  for (const [group, issues] of Object.entries(validationErrors(rawErrors))) {
    const issue = issues[0];
    if (issue !== undefined) data[group.includes(".") ? group.slice(group.indexOf(".") + 1) : group] = translate(issue.key, issue.parameters);
  }
  context.send({ event: "validation.failed", data: Object.freeze(data) });
  return undefined;
}
function validationErrors(input: unknown): Readonly<Record<string, readonly Readonly<{ key: string; parameters: Readonly<Record<string, string | number | boolean | bigint | null>> }>[]>> {
  if (typeof input !== "object" || input === null) return Object.freeze({});
  const output: Record<string, readonly Readonly<{ key: string; parameters: Readonly<Record<string, string | number | boolean | bigint | null>> }>[] > = Object.create(null);
  for (const [group, value] of Object.entries(input)) {
    if (!Array.isArray(value)) continue;
    output[group] = Object.freeze(value.flatMap((issue): readonly Readonly<{ key: string; parameters: Readonly<Record<string, string | number | boolean | bigint | null>> }>[] => {
      if (typeof issue !== "object" || issue === null || !("message" in issue)) return [];
      const message = issue.message;
      if (typeof message !== "object" || message === null || !("key" in message) || typeof message.key !== "string" || !("parameters" in message) || typeof message.parameters !== "object" || message.parameters === null) return [];
      return [Object.freeze({ key: message.key, parameters: message.parameters as Readonly<Record<string, string | number | boolean | bigint | null>> })];
    }));
  }
  return Object.freeze(output);
}
function translatorFromInput(input: unknown): (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => string {
  if (typeof input === "object" && input !== null && "__translate" in input && typeof input.__translate === "function") return input.__translate as ReturnType<typeof translatorFromInput>;
  return DEFAULT_TRANSLATE;
}
function normalizeHttpResult(value: unknown): Response | Promise<Response> {
  if (value instanceof Response) return value;
  if (isThenable(value)) return value.then((result) => {
    if (!(result instanceof Response)) throw new RuntimeBootstrapError("Generated HTTP Handler returned an invalid response.");
    return result;
  });
  throw new RuntimeBootstrapError("Generated HTTP Handler returned an invalid response.");
}
function normalizeHttpResultProfiled(value: unknown, profiler: HttpHotPathProfiler): Response | Promise<Response> {
  if (value instanceof Response) {
    const startedAt = performance.now();
    const response = normalizeHttpResult(value);
    profiler.record("responseNormalization", performance.now() - startedAt);
    return response;
  }
  if (isThenable(value)) {
    return value.then((result) => {
      const startedAt = performance.now();
      const response = normalizeHttpResult(result);
      profiler.record("responseNormalization", performance.now() - startedAt);
      return response;
    });
  }
  const startedAt = performance.now();
  try {
    return normalizeHttpResult(value);
  } finally {
    profiler.record("responseNormalization", performance.now() - startedAt);
  }
}
function sanitizeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return reason.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 123);
}
function safeError(cause: unknown): string { return cause instanceof Error ? cause.message : "Unknown Runtime failure"; }
function configureDailyErrorLogging(logging: LoggingConfig, workspaceRoot: string): void {
  const file = logging.channels.file;
  Console.configureDailyFileLogger(file.enabled ? Object.freeze({
    enabled: true,
    directory: resolve(workspaceRoot, file.path),
    retentionDays: file.retentionDays,
  }) : undefined);
}
function launcherConfiguration(
  kind: KnownTransport,
  transport: Readonly<unknown>,
  runtime: RuntimeConfig,
  development: boolean,
  logging: LoggingConfig,
  httpProfiler: HttpHotPathProfiler | undefined,
): Readonly<Record<string, unknown>> {
  const value = typeof transport === "object" && transport !== null ? transport : Object.freeze({});
  const activation = runtime.transports[kind];
  const mode = kind === "websocket" && activation.mode === "standalone" ? "dedicated" : activation.mode;
  return Object.freeze({
    ...value,
    host: runtime.network.host,
    ...(activation.port === undefined ? {} : { port: activation.port }),
    ...(mode === undefined ? {} : { mode }),
    development,
    logging: Object.freeze({
      requests: logging.requests,
      runtime: logging.runtime,
      transports: logging.transports,
      websocket: logging.websocket,
      errors: logging.errors,
      fatal: logging.fatal,
      startup: logging.startup,
      debug: logging.debug,
    }),
    ...(kind === "http" && httpProfiler !== undefined ? { profiling: Object.freeze({ http: httpProfiler }) } : {}),
  });
}
async function withTimeout(operation: Promise<void>, timeoutMs: number | undefined): Promise<void> {
  if (timeoutMs === undefined) return operation;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RuntimeShutdownError("Runtime shutdown timeout must be a positive safe integer.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RuntimeShutdownError("Runtime transport shutdown timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
