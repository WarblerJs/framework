import { Container, runInInjectionContext, type ProviderToken } from "@warbler/core";
import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import { InvalidApplicationBindingsError, ProviderResolutionError, RuntimeProviderNotFoundError } from "../errors/runtime-errors";
import type { ProviderBinding, ProviderBindingContext } from "../generated/executable-bindings";

/** Indexed eager provider container shared by Root and Graph ownership levels. */
export class GeneratedProviderContainer {
  readonly #core: Container;
  readonly #bindings: readonly (ProviderBinding | undefined)[];
  readonly #scope: "root" | "graph";
  readonly #graphId: number;
  readonly #root: GeneratedProviderContainer | undefined;
  readonly #instances: unknown[];
  readonly #created: boolean[];
  readonly #creating = new Set<number>();
  readonly #creationOrder: number[] = [];

  public constructor(
    bindings: readonly (ProviderBinding | undefined)[],
    scope: "root" | "graph",
    graphId = -1,
    root?: GeneratedProviderContainer,
  ) {
    this.#bindings = bindings;
    this.#scope = scope;
    this.#graphId = graphId;
    this.#root = root;
    this.#core = new Container(root?.core);
    this.#instances = new Array(bindings.length);
    this.#created = new Array(bindings.length).fill(false);
  }
  /** Core container used only to preserve functional inject(). */
  public get core(): Container { return this.#core; }
  /** Graph owner, or -1 for Root. */
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
      if (binding.scope === "root" && this.#root !== undefined) return this.#root.create(providerId);
      throw new InvalidApplicationBindingsError(RuntimeDiagnosticCode.PROVIDER_SCOPE_VIOLATION, "Generated provider is not visible from this Graph.", { providerId, graphId: this.#graphId });
    }
    if (this.#creating.has(providerId)) throw new ProviderResolutionError(`Generated provider dependency cycle: ${providerId}`);
    this.#creating.add(providerId);
    try {
      for (const dependencyId of binding.dependencyIds) {
        const dependency = this.#bindings[dependencyId];
        if (dependency?.scope === "root" && this.#scope === "graph") await this.#root!.create(dependencyId);
        else await this.create(dependencyId);
      }
      const result = binding.factory(bindingContext(this.#core));
      const instance = isThenable(result) ? await result : result;
      this.#instances[providerId] = instance;
      this.#created[providerId] = true;
      this.#creationOrder.push(providerId);
      this.#core.register({ token: binding.token, useValue: instance });
      return instance;
    } catch (cause) {
      if (cause instanceof RuntimeProviderNotFoundError || cause instanceof InvalidApplicationBindingsError || cause instanceof ProviderResolutionError) throw cause;
      throw new ProviderResolutionError(`${RuntimeDiagnosticCode.PROVIDER_FACTORY_FAILED}: Generated provider ${providerId} failed to initialize.`, { cause });
    } finally {
      this.#creating.delete(providerId);
    }
  }
  /** Performs direct indexed lookup after eager startup. */
  public resolve(providerId: number): unknown {
    if (this.#created[providerId]) return this.#instances[providerId];
    const binding = this.#bindings[providerId];
    if (binding?.scope === "root" && this.#root !== undefined) return this.#root.resolve(providerId);
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
    return this.#scope === "root" ? binding.scope === "root" : binding.scope === "graph" && binding.graphId === this.#graphId;
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
function bindingContext(container: Container): ProviderBindingContext {
  return Object.freeze({
    resolve: <T>(token: ProviderToken<T>): T => container.resolve(token),
    run: <T>(callback: () => T): T => runInInjectionContext(container, callback),
  });
}
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
