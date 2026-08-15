import { runInInjectionContext, type InjectionResolver, type ProviderToken } from "@warbler/core";
import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import { InvalidApplicationBindingsError, ProviderResolutionError, RuntimeProviderNotFoundError } from "../errors/runtime-errors";
import type { ProviderBinding, ProviderBindingContext } from "../generated/executable-bindings";

/**
 * Indexed eager provider container shared by Root, Graph, and Request ownership levels.
 *
 * Token resolution is one `Map` hop (token -> dense provider id, built once from the bindings array at
 * construction) followed entirely by array indexing — no per-resolve token-keyed record lookup, and no
 * separate `@warbler/core` `Container` shadowing the instance cache: an instance lives in exactly one
 * place, `#instances[id]`.
 */
export class GeneratedProviderContainer implements InjectionResolver {
  readonly #bindings: readonly (ProviderBinding | undefined)[];
  readonly #tokenIds: Map<ProviderToken<unknown>, number>;
  readonly #scope: "root" | "graph" | "request" | "controller";
  readonly #graphId: number;
  readonly #controllerId: number;
  readonly #parent: GeneratedProviderContainer | undefined;
  readonly #instances: unknown[];
  readonly #created: boolean[];
  readonly #creating = new Set<number>();
  readonly #creationOrder: number[] = [];

  public constructor(
    bindings: readonly (ProviderBinding | undefined)[],
    scope: "root" | "graph" | "request" | "controller",
    graphId = -1,
    controllerId = -1,
    parent?: GeneratedProviderContainer,
  ) {
    this.#bindings = bindings;
    this.#scope = scope;
    this.#graphId = graphId;
    this.#controllerId = controllerId;
    this.#parent = parent;
    this.#tokenIds = new Map();
    const tokenPriorities = new Map<ProviderToken<unknown>, number>();
    for (const binding of bindings) {
      if (binding === undefined) continue;
      const priority = tokenPriority(binding, scope, graphId, controllerId);
      if (priority < 0) continue;
      const current = tokenPriorities.get(binding.token) ?? -1;
      if (priority >= current) {
        tokenPriorities.set(binding.token, priority);
        this.#tokenIds.set(binding.token, binding.id);
      }
    }
    this.#instances = new Array(bindings.length);
    this.#created = new Array(bindings.length).fill(false);
  }
  /** Graph owner, or -1 for Root/Request-outside-a-Graph. */
  public get graphId(): number { return this.#graphId; }
  /** Dense provider binding index shared by generated owner containers. */
  public get bindings(): readonly (ProviderBinding | undefined)[] { return this.#bindings; }

  /** Eagerly creates this container's generated providers in deterministic ID order. */
  public async initialize(): Promise<void> {
    for (let id = 0; id < this.#bindings.length; id++) {
      const binding = this.#bindings[id];
      if (binding !== undefined && this.#owns(binding)) await this.create(id);
    }
  }
  /** Eagerly creates selected providers owned by this container. */
  public async initializeOnly(providerIds: readonly number[]): Promise<void> {
    for (let index = 0; index < providerIds.length; index++) await this.create(providerIds[index]!);
  }
  /** Creates one provider after its compiler-supplied dependencies. */
  public async create(providerId: number): Promise<unknown> {
    if (this.#created[providerId]) return this.#instances[providerId];
    const binding = this.#bindings[providerId];
    if (binding === undefined) throw new RuntimeProviderNotFoundError(`${RuntimeDiagnosticCode.PROVIDER_NOT_FOUND}: Generated provider not found: ${providerId}`);
    if (!this.#owns(binding)) {
      if (this.#parent !== undefined) return this.#parent.create(providerId);
      throw new InvalidApplicationBindingsError(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Generated provider is not visible from this Graph.", { providerId, graphId: this.#graphId });
    }
    if (this.#creating.has(providerId)) throw new ProviderResolutionError(`Generated provider dependency cycle: ${providerId}`);
    this.#creating.add(providerId);
    try {
      for (const dependencyId of binding.dependencyIds) await this.create(dependencyId);
      const result = binding.factory(bindingContext(this));
      const instance = isThenable(result) ? await result : result;
      this.#instances[providerId] = instance;
      this.#created[providerId] = true;
      this.#creationOrder.push(providerId);
      return instance;
    } catch (cause) {
      if (cause instanceof RuntimeProviderNotFoundError || cause instanceof InvalidApplicationBindingsError || cause instanceof ProviderResolutionError) throw cause;
      throw new ProviderResolutionError(`${RuntimeDiagnosticCode.PROVIDER_FACTORY_FAILED}: Generated provider ${providerId} failed to initialize.`, { cause });
    } finally {
      this.#creating.delete(providerId);
    }
  }
  /** Resolves a provider by its numeric ID (direct indexed lookup after eager creation). */
  resolve(providerId: number): unknown;
  /** Resolves a provider by its token — one `Map` hop to the numeric ID, then direct indexed lookup. */
  resolve<T>(token: ProviderToken<T>): T;
  resolve(key: number | ProviderToken<unknown>): unknown {
    const id = typeof key === "number" ? key : this.#tokenIds.get(key);
    if (id === undefined) throw new RuntimeProviderNotFoundError(`${RuntimeDiagnosticCode.PROVIDER_NOT_FOUND}: Generated provider token not found.`);
    return this.#resolveId(id);
  }
  /** Resolves a provider by token, or returns undefined when it isn't registered/created. */
  resolveOptional<T>(token: ProviderToken<T>): T | undefined {
    const id = this.#tokenIds.get(token);
    if (id === undefined) return undefined;
    try { return this.#resolveId(id) as T; } catch { return undefined; }
  }
  /** Registers an externally created instance (e.g. a Controller) under its own token, extending the dense ID space. */
  public registerExternal(token: ProviderToken<unknown>, instance: unknown): void {
    const id = this.#instances.length;
    this.#tokenIds.set(token, id);
    this.#instances.push(instance);
    this.#created.push(true);
  }
  #resolveId(providerId: number): unknown {
    if (this.#created[providerId]) return this.#instances[providerId];
    const binding = this.#bindings[providerId];
    if (binding !== undefined && !this.#owns(binding) && this.#parent !== undefined) return this.#parent.#resolveId(providerId);
    throw new RuntimeProviderNotFoundError(`${RuntimeDiagnosticCode.PROVIDER_NOT_FOUND}: Generated provider instance not found: ${providerId}`);
  }
  /** Disposes explicitly generated lifecycle bindings in reverse creation order. */
  public async dispose(): Promise<void> {
    let failure: unknown;
    for (let index = this.#creationOrder.length - 1; index >= 0; index--) {
      const providerId = this.#creationOrder[index]!;
      const binding = this.#bindings[providerId]!;
      if (binding.dispose !== undefined) {
        try { await binding.dispose(this.#instances[providerId]); } catch (cause) { failure ??= cause; }
      }
      this.#instances[providerId] = undefined;
      this.#created[providerId] = false;
    }
    this.#creationOrder.length = 0;
    if (failure !== undefined) throw new ProviderResolutionError("Generated provider disposal failed.", { cause: failure });
  }
  #owns(binding: ProviderBinding): boolean {
    if (this.#scope === "root") return binding.scope === "root";
    if (this.#scope === "graph") return binding.scope === "graph" && binding.graphId === this.#graphId;
    if (this.#scope === "controller") return binding.scope === "controller" && binding.graphId === this.#graphId && binding.controllerId === this.#controllerId;
    return binding.scope === "request" && binding.graphId === this.#graphId;
  }
}

/** Root provider owner with one instance per Runtime. */
export class RootProviderContainer extends GeneratedProviderContainer {
  public constructor(bindings: readonly (ProviderBinding | undefined)[]) { super(bindings, "root"); }
}
/** Graph provider owner with direct Root fallback. */
export class GraphProviderContainer extends GeneratedProviderContainer {
  public constructor(bindings: readonly (ProviderBinding | undefined)[], graphId: number, root: RootProviderContainer) {
    super(bindings, "graph", graphId, -1, root);
  }
}
/** Controller provider owner with direct Graph fallback. */
export class ControllerProviderContainer extends GeneratedProviderContainer {
  public constructor(bindings: readonly (ProviderBinding | undefined)[], graphId: number, controllerId: number, graph: GraphProviderContainer) {
    super(bindings, "controller", graphId, controllerId, graph);
  }
}
/**
 * Request-scoped provider owner: created fresh per request, falls back to its owning Graph (which itself
 * falls back to Root). Not part of Runtime startup — `initialize()` is awaited once per request, before
 * the guard/middleware/handler pipeline runs, so request-scoped `inject()` calls stay synchronous.
 */
export class RequestProviderContainer extends GeneratedProviderContainer {
  public constructor(bindings: readonly (ProviderBinding | undefined)[], graphId: number, graph: GraphProviderContainer) {
    super(bindings, "request", graphId, -1, graph);
  }
}
function bindingContext(resolver: InjectionResolver): ProviderBindingContext {
  return Object.freeze({
    resolve: <T>(token: ProviderToken<T>): T => resolver.resolve(token),
    run: <T>(callback: () => T): T => runInInjectionContext(resolver, callback),
  });
}
function tokenPriority(binding: ProviderBinding, scope: "root" | "graph" | "request" | "controller", graphId: number, controllerId: number): number {
  if (binding.scope === "root") return 0;
  if ((scope === "graph" || scope === "request" || scope === "controller") && binding.graphId === graphId && binding.scope === "graph") return 1;
  if (scope === "request" && binding.graphId === graphId && binding.scope === "request") return 2;
  if (scope === "controller" && binding.graphId === graphId && binding.controllerId === controllerId && binding.scope === "controller") return 2;
  return -1;
}
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
