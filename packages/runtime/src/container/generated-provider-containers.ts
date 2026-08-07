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
  readonly #scope: "root" | "graph" | "request";
  readonly #graphId: number;
  readonly #parent: GeneratedProviderContainer | undefined;
  readonly #instances: unknown[];
  readonly #created: boolean[];
  readonly #creating = new Set<number>();
  readonly #creationOrder: number[] = [];

  public constructor(
    bindings: readonly (ProviderBinding | undefined)[],
    scope: "root" | "graph" | "request",
    graphId = -1,
    parent?: GeneratedProviderContainer,
  ) {
    this.#bindings = bindings;
    this.#scope = scope;
    this.#graphId = graphId;
    this.#parent = parent;
    this.#tokenIds = new Map();
    for (const binding of bindings) if (binding !== undefined) this.#tokenIds.set(binding.token, binding.id);
    this.#instances = new Array(bindings.length);
    this.#created = new Array(bindings.length).fill(false);
  }
  /** Graph owner, or -1 for Root/Request-outside-a-Graph. */
  public get graphId(): number { return this.#graphId; }

  /** Eagerly creates this container's generated providers in deterministic ID order. */
  public async initialize(): Promise<void> {
    for (let id = 0; id < this.#bindings.length; id++) {
      const binding = this.#bindings[id];
      if (binding !== undefined && this.#owns(binding)) await this.create(id);
    }
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
    super(bindings, "graph", graphId, root);
  }
}
/**
 * Request-scoped provider owner: created fresh per request, falls back to its owning Graph (which itself
 * falls back to Root). Not part of Runtime startup — `initialize()` is awaited once per request, before
 * the guard/middleware/handler pipeline runs, so request-scoped `inject()` calls stay synchronous.
 */
export class RequestProviderContainer extends GeneratedProviderContainer {
  public constructor(bindings: readonly (ProviderBinding | undefined)[], graphId: number, graph: GraphProviderContainer) {
    super(bindings, "request", graphId, graph);
  }
}
function bindingContext(resolver: InjectionResolver): ProviderBindingContext {
  return Object.freeze({
    resolve: <T>(token: ProviderToken<T>): T => resolver.resolve(token),
    run: <T>(callback: () => T): T => runInInjectionContext(resolver, callback),
  });
}
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
