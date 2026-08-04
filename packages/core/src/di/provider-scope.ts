import { getProviderMetadata, type ProviderMetadata } from "../decorators";
import { DuplicateProviderError, ProviderNotFoundError, ProviderScopeError } from "../errors";
import type { Constructor } from "../types";
import { Container } from "./container";
import { ProviderScope } from "./provider";
import type { Provider } from "./provider";
import { tokenName } from "./token";

/** Compiler input describing one Graph's providers and analyzed dependencies. */
export interface ProviderGraphInput {
  readonly graph: Constructor;
  readonly providers: readonly Provider[];
  readonly dependencies?: ReadonlyMap<Constructor, readonly Constructor[]>;
}

/** O(1) provider collection generated for one Graph. */
export interface CompiledGraphProviders {
  readonly graph: Constructor;
  readonly providers: ReadonlyMap<Constructor, Provider>;
}

/** Immutable compiler output split into root and Graph-local lookup tables. */
export interface CompiledProviderScopes {
  readonly root: ReadonlyMap<Constructor, Provider>;
  readonly graphs: ReadonlyMap<Constructor, CompiledGraphProviders>;
}

/**
 * Compiles provider visibility into direct lookup tables and rejects Graph boundary violations.
 *
 * Source analysis supplies `dependencies`; runtime never performs visibility validation.
 */
export function compileProviderScopes(inputs: readonly ProviderGraphInput[]): CompiledProviderScopes {
  const root = new Map<Constructor, Provider>();
  const graphs = new Map<Constructor, CompiledGraphProviders>();
  const graphOwners = new Map<Constructor, Constructor>();

  for (const input of inputs) {
    if (graphs.has(input.graph)) throw new DuplicateProviderError(input.graph.name);
    const local = new Map<Constructor, Provider>();
    for (const provider of input.providers) {
      const token = providerConstructor(provider);
      const metadata = getProviderMetadata(token);
      const visibility = metadata?.provide ?? ProviderScope.GRAPH;
      const destination = visibility === ProviderScope.ROOT ? root : local;
      if (destination.has(token)) throw new DuplicateProviderError(tokenName(token));
      destination.set(token, provider);
      if (visibility === ProviderScope.GRAPH) {
        const owner = graphOwners.get(token);
        if (owner !== undefined && owner !== input.graph) throw new DuplicateProviderError(tokenName(token));
        graphOwners.set(token, input.graph);
      }
    }
    graphs.set(input.graph, Object.freeze({ graph: input.graph, providers: local }));
  }

  for (const input of inputs) {
    const compiled = graphs.get(input.graph);
    if (compiled === undefined) throw new ProviderNotFoundError(input.graph.name);
    for (const [consumer, dependencies] of input.dependencies ?? []) {
      if (!compiled.providers.has(consumer) && !root.has(consumer)) throw new ProviderNotFoundError(tokenName(consumer));
      for (const dependency of dependencies) {
        if (root.has(consumer)) {
          if (root.has(dependency)) continue;
          const owner = graphOwners.get(dependency);
          if (owner !== undefined) throw new ProviderScopeError(tokenName(dependency), owner.name, input.graph.name);
          throw new ProviderNotFoundError(tokenName(dependency));
        }
        if (compiled.providers.has(dependency) || root.has(dependency)) continue;
        const owner = graphOwners.get(dependency);
        if (owner !== undefined) throw new ProviderScopeError(tokenName(dependency), owner.name, input.graph.name);
        throw new ProviderNotFoundError(tokenName(dependency));
      }
    }
  }

  return Object.freeze({ root, graphs });
}

/** Creates runtime containers whose only resolution path is Graph provider then root provider. */
export function createProviderContainers(compiled: CompiledProviderScopes): ReadonlyMap<Constructor, Container> {
  const root = new Container().registerAll([...compiled.root.values()].map(materializeProvider));
  const containers = new Map<Constructor, Container>();
  for (const [graph, collection] of compiled.graphs) {
    containers.set(graph, new Container(root).registerAll([...collection.providers.values()].map(materializeProvider)));
  }
  return containers;
}

function materializeProvider(provider: Provider): Provider {
  if (typeof provider !== "function") return provider;
  const metadata = getProviderMetadata(provider as Constructor);
  if (metadata?.scope !== "transient") return provider;
  return Object.freeze({ token: provider, useClass: provider, scope: metadata.scope });
}

/** Returns provider metadata with compiler-supplied immutable dependencies. */
export function withProviderDependencies(metadata: ProviderMetadata, dependencies: readonly Constructor[]): ProviderMetadata {
  return Object.freeze({ ...metadata, dependencies: Object.freeze([...dependencies]) });
}

function providerConstructor(provider: Provider): Constructor {
  if (typeof provider === "function") return provider as Constructor;
  if (typeof provider.token === "function") return provider.token as Constructor;
  throw new TypeError("Provider scope compilation requires constructor tokens");
}
