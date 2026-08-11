import {
  loadRuntimeConfig,
  loadLoggingConfig,
  loadTransportConfig,
  normalizeRuntimeConfig,
  normalizeLoggingConfig,
  type LoggingConfig,
  type RuntimeConfig,
  type TransportName,
} from "@warbler/config";
import { Console } from "@warbler/console";
import { loadProjectTranslator, localizeRequest, type CatalogTranslator } from "@warbler/i18n";
import { RequestContextStore, runInRequestContext } from "@warbler/core";
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
import { createMiddlewarePipeline, executeGuardRange, executeHandler, executeValidator } from "../pipelines";
import { RuntimeState, type RuntimeStateValue } from "../state/runtime-state";
import { TransportLauncherRegistry } from "../transports/transport-launcher-registry";
import type {
  RunningTransport,
  RuntimeExecutionContext,
  RuntimeTransportLauncher,
  RuntimeTransportStartInput,
  RuntimeTransportStopOptions,
} from "../transports/runtime-transport-launcher";

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
    return executeHandler(binding, this.#controllers.get(binding.controllerId), input);
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
        config: launcherConfiguration(kind, transportConfig, config, this.#options.development ?? false, this.#logging),
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
    const pipelines = this.application.application.routeTable.map((record) => this.#compileRecordPipeline(record, true));
    return http.createRoutes((routeId, request, validationInput) => {
      const pipeline = pipelines[routeId];
      if (pipeline === undefined) throw new RuntimeBootstrapError(`Generated HTTP route not found: ${routeId}`);
      const input = this.#translator === undefined
        ? request
        : localizeRequest(request, this.#translator, this.#translator.config);
      const pipelineInput = validationInput === undefined
        ? input
        : Object.freeze({
          ...(typeof validationInput === "object" && validationInput !== null ? validationInput : {}),
          __request: input,
          __translate: typeof input === "object" && input !== null && "tr" in input && typeof input.tr === "function"
            ? ((translateRequest) => (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => translateRequest(key, parameters))(input.tr as (key: string, parameters?: Readonly<Record<string, string | number | boolean | bigint | null>>) => string)
            : undefined,
        });
      const result = pipeline(pipelineInput);
      return normalizeHttpResult(result);
    });
  }
  #executeSocket(event: string, message: unknown, context: unknown): unknown {
    return this.#socketPipelines[event]?.(Object.freeze({ message, context }));
  }
  #createSocketPipelines(): Readonly<Record<string, (input: unknown) => unknown>> {
    const result: Record<string, (input: unknown) => unknown> = Object.create(null);
    const events: Readonly<Record<string, Readonly<Record<string, unknown>>>> = this.application.websocket?.events ?? Object.freeze({});
    for (const [event, record] of Object.entries(events)) {
      result[event] = this.#compileRecordPipeline(record, false, event);
    }
    return Object.freeze(result);
  }
  #compileRecordPipeline(record: Readonly<Record<string, unknown>>, http: boolean, socketEvent?: string): (input: unknown) => unknown {
    const handlerId = numberField(record, "handlerId");
    const validatorId = numberField(record, "validatorId");
    const controllerId = numberField(record, "controllerId");
    const guardIds = rangeIds(record, "guardStart", "guardCount", http ? this.application.application.routeGuards : this.application.application.socketGuards);
    const middlewareIds = rangeIds(record, "middlewareStart", "middlewareCount", http ? this.application.application.routeMiddleware : this.application.application.socketMiddleware);
    // For HTTP, `context` is the request's RequestContextStore: guards/middleware may
    // still call `.set(...)` right up until this terminal step, so it's settled here —
    // right before the handler runs — rather than eagerly. `settle()` keeps its own
    // synchronous fast path when nothing async was set, matching `runValidated`'s.
    const terminal = createMiddlewarePipeline(this.#indexes!.middleware, middlewareIds, (pipelineValue, context) => {
      if (!http) return this.invokeHandler(handlerId, socketInputs(pipelineValue, socketEvent));
      const settled = (context as RequestContextStore).settle();
      if (isThenable(settled)) return settled.then(() => this.invokeHandler(handlerId, [pipelineValue]));
      return this.invokeHandler(handlerId, [pipelineValue]);
    });
    const core = (input: unknown): unknown => {
      const validationInput = http ? input : socketValidationInput(input, socketEvent);
      const validator = this.#indexes!.validators[validatorId];
      return runValidated(validator, validationInput, (validated) => {
        const requestContext = new RequestContextStore();
        const pipelineValue = http ? buildAppRequest(validationInput, validated, requestContext) : socketValidatedEnvelope(input, validated);
        const guardContext = http ? requestContext : socketConnectionContext(pipelineValue);
        const guarded = executeGuardRange(this.#indexes!.guards, guardIds, pipelineValue, guardContext);
        if (isThenable(guarded)) return guarded.then((allowed) => allowed ? terminal(pipelineValue, guardContext) : http ? forbidden() : undefined);
        return guarded ? terminal(pipelineValue, guardContext) : http ? forbidden() : undefined;
      }, (outcome) => http ? invalidHttpValidation(validator, outcome.errors, validationInput) : socketValidationFailure(input, outcome.errors));
    };
    // Only wrap requests in a fresh request-scoped container when the owning Graph actually declares
    // request-scoped providers — otherwise every request would pay for an unused eager-init pass.
    const graphId = this.#indexes!.controllers[controllerId]?.graphId;
    const hasRequestScoped = graphId !== undefined && this.application.providers.some((provider) => provider.scope === "request" && provider.graphId === graphId);
    if (!hasRequestScoped) return core;
    const graph = this.#graphMap.get(graphId!)!;
    return (input: unknown): unknown => this.#runWithRequestScope(graph, graphId!, () => core(input));
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
function runValidated(
  validator: import("../generated/executable-bindings").ValidatorBinding | undefined,
  input: unknown,
  terminal: (input: unknown) => unknown,
  onInvalid: (outcome: Readonly<{ valid: boolean; errors?: unknown }>) => unknown = () => invalidRequest(),
): unknown {
  const result = executeValidator(validator, input);
  const successValue = (outcome: Readonly<{ value: unknown }>): unknown =>
    typeof validator?.flags === "number" ? outcome : outcome.value;
  if (isThenable(result)) return result.then((outcome) => outcome.valid ? terminal(successValue(outcome)) : onInvalid(outcome));
  return result.valid ? terminal(successValue(result)) : onInvalid(result);
}
function rangeIds(record: Readonly<Record<string, unknown>>, startKey: string, countKey: string, values: readonly number[] | undefined): readonly number[] {
  const start = numberField(record, startKey);
  const count = numberField(record, countKey);
  return count === 0 ? Object.freeze([]) : Object.freeze(values!.slice(start, start + count));
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
function buildAppRequest(validationInput: unknown, body: unknown, requestContext: RequestContextStore): unknown {
  if (typeof validationInput !== "object" || validationInput === null || !("__request" in validationInput)) return body;
  const request = validationInput.__request;
  if (!(request instanceof Request)) return body;
  const source = request as Request & Readonly<Record<string, unknown>>;
  const outcome = validationOutcome(body);
  return Object.freeze({
    native: request,
    body: outcome?.value ?? body,
    params: outcome?.path ?? source.params ?? Object.freeze({}),
    query: outcome?.query ?? source.query ?? Object.freeze({}),
    headers: request.headers,
    cookies: requestCookieMap(request),
    get context(): Readonly<Record<string, unknown>> { return requestContext.currentView(); },
    locale: typeof source.locale === "string" ? source.locale : "en",
    tr: typeof source.tr === "function" ? source.tr : (key: string) => key,
  });
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
): unknown {
  const handler = validator?.onValidationError;
  if (typeof handler !== "function") return invalidValidationResponse(rawErrors, validationInput);
  const req = buildAppRequest(validationInput, rawRequestValue(validationInput), new RequestContextStore());
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
  return (key) => key;
}
function normalizeHttpResult(value: unknown): Response | Promise<Response> {
  if (value instanceof Response) return value;
  if (isThenable(value)) return value.then((result) => {
    if (!(result instanceof Response)) throw new RuntimeBootstrapError("Generated HTTP Handler returned an invalid response.");
    return result;
  });
  throw new RuntimeBootstrapError("Generated HTTP Handler returned an invalid response.");
}
function sanitizeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return reason.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 123);
}
function safeError(cause: unknown): string { return cause instanceof Error ? cause.message : "Unknown Runtime failure"; }
function launcherConfiguration(
  kind: KnownTransport,
  transport: Readonly<unknown>,
  runtime: RuntimeConfig,
  development: boolean,
  logging: LoggingConfig,
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
