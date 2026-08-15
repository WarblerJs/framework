import { runInInjectionContext, type ProviderToken } from "@warbler/core";
import { ControllerProviderContainer, type GraphProviderContainer } from "../container/generated-provider-containers";
import { ControllerCreationError, GeneratedArtifactError } from "../errors/runtime-errors";
import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import type { ControllerBinding, ProviderBindingContext } from "../generated/executable-bindings";

/** Runtime-owned direct indexed Controller instances created once at startup. */
export class ControllerInstanceTable {
  readonly #bindings: readonly (ControllerBinding | undefined)[];
  readonly #graphs: ReadonlyMap<number, GraphProviderContainer>;
  readonly #instances: unknown[];
  readonly #created: boolean[];
  readonly #containers: Array<ControllerProviderContainer | undefined>;
  readonly #creationOrder: number[] = [];

  public constructor(bindings: readonly (ControllerBinding | undefined)[], graphs: ReadonlyMap<number, GraphProviderContainer>) {
    this.#bindings = bindings;
    this.#graphs = graphs;
    this.#instances = new Array(bindings.length);
    this.#created = new Array(bindings.length).fill(false);
    this.#containers = new Array(bindings.length);
  }
  /** Creates every Controller once in deterministic numeric-ID order. */
  public async initialize(): Promise<void> {
    for (let id = 0; id < this.#bindings.length; id++) {
      const binding = this.#bindings[id];
      if (binding === undefined) continue;
      const graph = this.#graphs.get(binding.graphId);
      if (graph === undefined) throw new ControllerCreationError(`Generated Controller ${id} has no Graph container.`);
      try {
        const container = new ControllerProviderContainer(this.#bindingsToProviders(), binding.graphId, binding.id, graph);
        await container.initializeOnly(binding.providerIds ?? emptyProviderIds);
        const result = binding.factory(context(container));
        const instance = isThenable(result) ? await result : result;
        this.#instances[id] = instance;
        this.#created[id] = true;
        this.#containers[id] = container;
        this.#creationOrder.push(id);
        container.registerExternal(binding.token, instance);
      } catch (cause) {
        throw new ControllerCreationError(`${RuntimeDiagnosticCode.CONTROLLER_FACTORY_FAILED}: Generated Controller ${id} failed to initialize.`, { cause });
      }
    }
  }
  /** Returns one Controller through direct indexed lookup. */
  public get(controllerId: number): unknown {
    if (!this.#created[controllerId]) throw new GeneratedArtifactError(`Generated Controller instance not found: ${controllerId}`);
    return this.#instances[controllerId];
  }
  /** Runs explicitly generated Controller disposal in reverse creation order. */
  public async dispose(): Promise<void> {
    let failure: unknown;
    for (let index = this.#creationOrder.length - 1; index >= 0; index--) {
      const id = this.#creationOrder[index]!;
      const binding = this.#bindings[id]!;
      if (binding.dispose !== undefined) {
        try { await binding.dispose(this.#instances[id]); } catch (cause) { failure ??= cause; }
      }
      try { await this.#containers[id]?.dispose(); } catch (cause) { failure ??= cause; }
      this.#containers[id] = undefined;
      this.#instances[id] = undefined;
      this.#created[id] = false;
    }
    this.#creationOrder.length = 0;
    if (failure !== undefined) throw new ControllerCreationError("Generated Controller disposal failed.", { cause: failure });
  }
  #bindingsToProviders(): ConstructorParameters<typeof ControllerProviderContainer>[0] {
    const first = this.#graphs.values().next().value;
    return first === undefined ? Object.freeze([]) : first.bindings;
  }
}
function context(graph: GraphProviderContainer | ControllerProviderContainer): ProviderBindingContext {
  return Object.freeze({
    resolve: <T>(token: ProviderToken<T>): T => graph.resolve(token),
    run: <T>(callback: () => T): T => runInInjectionContext(graph, callback),
  });
}
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
const emptyProviderIds: readonly number[] = Object.freeze([]);
