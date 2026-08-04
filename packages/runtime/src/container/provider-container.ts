import { ProviderResolutionError, RuntimeProviderNotFoundError } from "../errors/runtime-errors";
import type { RuntimeGeneratedApplication, RuntimeProviderRecord } from "../generated/generated-types";
import type { RuntimeProviderDisposer, RuntimeProviderFactory } from "../providers/provider-types";

interface ProviderOwner {
  resolve(providerId: number): unknown;
}

class ScopedProviderStore implements ProviderOwner {
  readonly #records: readonly (RuntimeProviderRecord | undefined)[];
  readonly #factories: readonly RuntimeProviderFactory[];
  readonly #disposers: Readonly<Record<number, RuntimeProviderDisposer>>;
  readonly #fallback: ProviderOwner | undefined;
  readonly #dependencyIds: readonly number[];
  readonly #instances: unknown[] = [];
  readonly #created: boolean[] = [];
  readonly #resolving = new Set<number>();
  readonly #creationOrder: number[] = [];

  public constructor(
    records: readonly (RuntimeProviderRecord | undefined)[],
    factories: readonly RuntimeProviderFactory[],
    disposers: Readonly<Record<number, RuntimeProviderDisposer>>,
    dependencyIds: readonly number[],
    fallback?: ProviderOwner,
  ) {
    this.#records = records;
    this.#factories = factories;
    this.#disposers = disposers;
    this.#dependencyIds = dependencyIds;
    this.#fallback = fallback;
  }

  public resolve(providerId: number): unknown {
    if (this.#created[providerId]) return this.#instances[providerId];
    const record = this.#records[providerId];
    if (record === undefined) {
      if (this.#fallback !== undefined) return this.#fallback.resolve(providerId);
      throw new RuntimeProviderNotFoundError(`Generated provider not found: ${providerId}`);
    }
    if (this.#resolving.has(providerId)) throw new ProviderResolutionError(`Generated provider dependency cycle at ${providerId}.`);
    const factory = this.#factories[providerId];
    if (factory === undefined) throw new ProviderResolutionError(`Generated provider factory not found: ${providerId}`);
    this.#resolving.add(providerId);
    try {
      const dependencies: unknown[] = [];
      const end = record.dependencyStart + record.dependencyCount;
      for (let index = record.dependencyStart; index < end; index++) {
        const dependencyId = this.#dependencyIds[index];
        if (dependencyId === undefined || dependencyId < 0) throw new ProviderResolutionError(`Invalid generated dependency for provider ${providerId}.`);
        dependencies.push(this.resolve(dependencyId));
      }
      const instance = factory(Object.freeze(dependencies));
      this.#instances[providerId] = instance;
      this.#created[providerId] = true;
      this.#creationOrder.push(providerId);
      return instance;
    } catch (cause) {
      if (cause instanceof ProviderResolutionError || cause instanceof RuntimeProviderNotFoundError) throw cause;
      throw new ProviderResolutionError(`Generated provider ${providerId} failed to initialize.`, { cause });
    } finally {
      this.#resolving.delete(providerId);
    }
  }

  public async dispose(): Promise<void> {
    for (let index = this.#creationOrder.length - 1; index >= 0; index--) {
      const providerId = this.#creationOrder[index]!;
      const disposer = this.#disposers[providerId];
      if (disposer !== undefined) {
        try { await disposer(this.#instances[providerId]); }
        catch (cause) { throw new ProviderResolutionError(`Generated provider ${providerId} failed to dispose.`, { cause }); }
      }
      this.#instances[providerId] = undefined;
      this.#created[providerId] = false;
    }
    this.#creationOrder.length = 0;
  }
}

/** O(1) root and Graph provider resolution over compiler-generated tables. */
export class RuntimeProviderContainers {
  readonly #root: ScopedProviderStore;
  readonly #graphs = new Map<number, ScopedProviderStore>();

  /** Creates root and Graph containers without inspecting application classes. */
  public constructor(
    generated: RuntimeGeneratedApplication,
    factories: readonly RuntimeProviderFactory[],
    disposers: Readonly<Record<number, RuntimeProviderDisposer>> = Object.freeze({}),
  ) {
    const rootRecords: Array<RuntimeProviderRecord | undefined> = [];
    const graphRecords = new Map<number, Array<RuntimeProviderRecord | undefined>>();
    for (const record of generated.providerTable) {
      if (!isProviderRecord(record) || record.id < 0 || !Number.isSafeInteger(record.id)) {
        throw new ProviderResolutionError("Generated provider table is malformed.");
      }
      if (record.root) rootRecords[record.id] = record;
      else {
        const records = graphRecords.get(record.graphId) ?? [];
        records[record.id] = record;
        graphRecords.set(record.graphId, records);
      }
    }
    this.#root = new ScopedProviderStore(rootRecords, factories, disposers, generated.providerDependencies);
    for (const [graphId, records] of graphRecords) {
      const container = new ScopedProviderStore(records, factories, disposers, generated.providerDependencies, this.#root);
      this.#graphs.set(graphId, container);
    }
  }

  /** Resolves a ROOT provider. */
  public resolveRoot(providerId: number): unknown {
    return this.#root.resolve(providerId);
  }

  /** Resolves a Graph provider, falling back directly to ROOT. */
  public resolveGraph(graphId: number, providerId: number): unknown {
    const graph = this.#graphs.get(graphId);
    if (graph === undefined) throw new RuntimeProviderNotFoundError(`Generated Graph container not found: ${graphId}`);
    return graph.resolve(providerId);
  }

  /** Disposes Graph providers followed by ROOT providers. */
  public async dispose(): Promise<void> {
    const graphIds = [...this.#graphs.keys()].sort((left, right) => right - left);
    for (const graphId of graphIds) await this.#graphs.get(graphId)!.dispose();
    await this.#root.dispose();
  }
}

function isProviderRecord(value: unknown): value is RuntimeProviderRecord {
  if (typeof value !== "object" || value === null) return false;
  return "id" in value && typeof value.id === "number" &&
    "graphId" in value && typeof value.graphId === "number" &&
    "root" in value && typeof value.root === "boolean" &&
    "dependencyStart" in value && typeof value.dependencyStart === "number" &&
    "dependencyCount" in value && typeof value.dependencyCount === "number";
}
