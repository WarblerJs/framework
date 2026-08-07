/**
 * Focused DI resolution benchmark. No benchmarking library exists anywhere in this repo (checked before
 * writing this), so this uses `Bun.nanoseconds()` directly, matching the codebase's existing timing style
 * (`@warbler/console`'s `Console.timer`) rather than introducing a new dependency.
 *
 * Run with: bun run packages/runtime/bench/di-resolution.bench.ts
 */
import { Container, createInjectionToken, type ProviderToken } from "@warbler/core";
import { GraphProviderContainer, RequestProviderContainer, RootProviderContainer } from "../src/container/generated-provider-containers";
import type { ProviderBinding, ProviderBindingContext } from "../src/generated/executable-bindings";

const ITERATIONS = 50_000;
const CHAIN_LENGTH = 8;

function time(label: string, iterations: number, run: () => void): void {
  // Warm up the JIT before measuring, matching standard microbenchmark practice.
  for (let i = 0; i < Math.min(1000, iterations); i++) run();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) run();
  const elapsedNs = Bun.nanoseconds() - start;
  const perOpNs = elapsedNs / iterations;
  console.log(`${label.padEnd(52)} ${perOpNs.toFixed(1).padStart(10)} ns/op  ${(1e9 / perOpNs).toFixed(0).padStart(12)} ops/sec`);
}
async function timeAsync(label: string, iterations: number, run: () => Promise<void>): Promise<void> {
  for (let i = 0; i < Math.min(200, iterations); i++) await run();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) await run();
  const elapsedNs = Bun.nanoseconds() - start;
  const perOpNs = elapsedNs / iterations;
  console.log(`${label.padEnd(52)} ${perOpNs.toFixed(1).padStart(10)} ns/op  ${(1e9 / perOpNs).toFixed(0).padStart(12)} ops/sec`);
}

class Leaf {}
class Chain {
  public constructor(public readonly next: unknown) {}
}

async function buildChainBindings(): Promise<{ root: RootProviderContainer; graph: GraphProviderContainer; chainToken: ProviderToken<unknown> }> {
  const leafToken = Leaf;
  const chainTokens: ProviderToken<unknown>[] = [leafToken];
  const bindings: ProviderBinding[] = [
    Object.freeze({ id: 0, token: leafToken, scope: "graph", graphId: 0, dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
  ];
  for (let index = 1; index < CHAIN_LENGTH; index++) {
    const token = createInjectionToken<unknown>(`chain-${index}`);
    chainTokens.push(token);
    const dependencyId = index - 1;
    bindings.push(Object.freeze({
      id: index, token, scope: "graph", graphId: 0, dependencyIds: Object.freeze([dependencyId]),
      factory: (context: ProviderBindingContext) => context.run(() => new Chain(context.resolve(bindings[dependencyId]!.token))),
    }));
  }
  const root = new RootProviderContainer(Object.freeze([]));
  const graph = new GraphProviderContainer(Object.freeze(bindings), 0, root);
  await graph.initialize();
  return { root, graph, chainToken: chainTokens[chainTokens.length - 1]! };
}

/** Rough stand-in for the pre-refactor architecture: a Map<token, record> plus double instance bookkeeping. */
class LegacyMapResolver {
  readonly #records = new Map<unknown, { readonly factory: () => unknown }>();
  readonly #singletons = new Map<unknown, unknown>();
  register(token: unknown, factory: () => unknown): void { this.#records.set(token, { factory }); }
  resolve<T>(token: unknown): T {
    if (this.#singletons.has(token)) return this.#singletons.get(token) as T;
    const record = this.#records.get(token);
    if (record === undefined) throw new Error("not found");
    const value = record.factory();
    this.#singletons.set(token, value);
    return value as T;
  }
}

async function main(): Promise<void> {
  console.log(`DI resolution benchmark — ${ITERATIONS.toLocaleString()} iterations, ${CHAIN_LENGTH}-deep dependency chain\n`);

  // --- Cold provider creation (root + graph, single provider each) ---
  await timeAsync("Cold creation: root container (1 provider)", 5000, async () => {
    const root = new RootProviderContainer(Object.freeze([
      Object.freeze({ id: 0, token: Leaf, scope: "root", dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
    ]));
    await root.initialize();
  });
  await timeAsync("Cold creation: graph container (1 provider, root fallback)", 5000, async () => {
    const root = new RootProviderContainer(Object.freeze([]));
    const graph = new GraphProviderContainer(Object.freeze([
      Object.freeze({ id: 0, token: Leaf, scope: "graph", graphId: 0, dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
    ]), 0, root);
    await graph.initialize();
  });

  // --- Cached resolution (post-initialize, the steady-state hot path) ---
  {
    const root = new RootProviderContainer(Object.freeze([
      Object.freeze({ id: 0, token: Leaf, scope: "root", dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
    ]));
    await root.initialize();
    time("Cached resolution: by numeric ID", ITERATIONS, () => { root.resolve(0); });
    time("Cached resolution: by token", ITERATIONS, () => { root.resolve(Leaf); });
  }

  // --- Nested dependency resolution ---
  {
    const { graph, chainToken } = await buildChainBindings();
    time(`Cached resolution: ${CHAIN_LENGTH}-deep chain (already built)`, ITERATIONS, () => { graph.resolve(chainToken); });
  }
  await timeAsync(`Cold creation: ${CHAIN_LENGTH}-deep dependency chain`, 2000, async () => {
    await buildChainBindings();
  });

  // --- Graph-scoped resolution with Root fallback ---
  {
    const root = new RootProviderContainer(Object.freeze([
      Object.freeze({ id: 0, token: Leaf, scope: "root", dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
    ]));
    const graph = new GraphProviderContainer(Object.freeze([
      Object.freeze({ id: 0, token: Leaf, scope: "root", dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
    ]), 0, root);
    await root.initialize();
    await graph.initialize();
    time("Graph-scoped resolution (root fallback, by token)", ITERATIONS, () => { graph.resolve(Leaf); });
  }

  // --- Request-scoped: fresh container per "request" ---
  {
    const root = new RootProviderContainer(Object.freeze([]));
    const bindings = Object.freeze([
      Object.freeze({ id: 0, token: Leaf, scope: "request", graphId: 0, dependencyIds: Object.freeze([]), factory: (context: ProviderBindingContext) => context.run(() => new Leaf()) }),
    ]);
    const graph = new GraphProviderContainer(bindings, 0, root);
    await timeAsync("Request-scoped: fresh container create + initialize", 5000, async () => {
      const request = new RequestProviderContainer(bindings, 0, graph);
      await request.initialize();
      request.resolve(Leaf);
    });
  }

  // --- Transient (Container-level lifetime, never cached) ---
  {
    const container = new Container();
    container.register({ token: Leaf, useClass: Leaf, scope: "transient" });
    time("Transient resolution (Container, never cached)", ITERATIONS, () => { container.resolve(Leaf); });
  }

  // --- Rough legacy comparison: hand-rolled Map<token, record> resolver ---
  {
    const legacy = new LegacyMapResolver();
    legacy.register(Leaf, () => new Leaf());
    time("Legacy-style comparison: Map<token, record> resolve", ITERATIONS, () => { legacy.resolve(Leaf); });
  }

  console.log("\nNote: the legacy comparison is a minimal stand-in for the pre-refactor Map<token, record>");
  console.log("architecture (the actual before-code no longer exists to benchmark head-to-head after this change).");
}

await main();
