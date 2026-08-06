import type { AnalysisResult, AnalyzedGraph } from "../analyzer/analyze-program";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostic";
import type { ApplicationWIR, ControllerWIR, GraphWIR, ProviderWIR, SourceLocationWIR } from "../wir/wir";

/** Validates analyzed declarations and produces immutable metadata-only WIR. */
export function validateApplication(projectRoot: string, analysis: AnalysisResult, diagnostics: CompilerDiagnostic[]): ApplicationWIR {
  const graphNames = new Map<string, AnalyzedGraph>();
  const controllerOwners = new Map<string, AnalyzedGraph>();
  const providerOwners = new Map<string, AnalyzedGraph>();
  const rootProviders = new Map<string, ProviderWIR>();
  const result: GraphWIR[] = [];

  /** Resolves a `provide:` token alias back to the provider's canonical WIR name. */
  const tokenNames = new Map<string, string>();
  for (const provider of analysis.providers.values()) if (provider.token !== undefined) tokenNames.set(provider.token, provider.name);

  for (const graph of analysis.graphs) {
    const priorName = graphNames.get(graph.name);
    if (priorName !== undefined) {
      add(diagnostics, DiagnosticCode.DUPLICATE_GRAPH, `Duplicate Graph "${graph.name}".`, graph, [graph.name, priorName.name]);
      continue;
    }
    graphNames.set(graph.name, graph);
  }

  for (const provider of analysis.providers.values()) if (provider.provide === "root") rootProviders.set(provider.name, provider);

  for (const graph of graphNames.values()) {
    const controllers: ControllerWIR[] = [];
    const providers: ProviderWIR[] = [];
    const localProviderNames = new Set<string>();
    for (const name of graph.controllerNames) {
      const controller = analysis.controllers.get(name);
      if (controller === undefined) {
        add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Graph "${graph.name}" references unknown controller "${name}".`, graph, [graph.name, name]);
        continue;
      }
      const owner = controllerOwners.get(name);
      if (owner !== undefined) {
        add(diagnostics, controller.kind === "http" ? DiagnosticCode.DUPLICATE_CONTROLLER : DiagnosticCode.DUPLICATE_SOCKET_CONTROLLER, `Controller "${name}" belongs to both "${owner.name}" and "${graph.name}".`, controller, [name, owner.name, graph.name]);
        continue;
      }
      controllerOwners.set(name, graph);
      controllers.push(controller);
    }
    for (const name of graph.providerNames) {
      const provider = analysis.providers.get(name);
      if (provider === undefined) {
        add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Graph "${graph.name}" references unknown provider "${name}".`, graph, [graph.name, name]);
        continue;
      }
      if (localProviderNames.has(name)) {
        add(diagnostics, DiagnosticCode.DUPLICATE_PROVIDER, `Graph "${graph.name}" declares provider "${name}" more than once.`, provider, [graph.name, name]);
        continue;
      }
      localProviderNames.add(name);
      if (provider.provide === "graph") {
        const owner = providerOwners.get(name);
        if (owner !== undefined && owner !== graph) {
          add(diagnostics, DiagnosticCode.DUPLICATE_PROVIDER, `Graph provider "${name}" belongs to both "${owner.name}" and "${graph.name}".`, provider, [name, owner.name, graph.name]);
          continue;
        }
        providerOwners.set(name, graph);
        providers.push(provider);
      }
    }
    validateRoutes(graph, controllers, diagnostics);
    validateSocketEvents(controllers, diagnostics);
    result.push(Object.freeze({
      ...copyLocation(graph), name: graph.name, prefix: normalizePath(graph.prefix), transport: graph.transport,
      controllers: Object.freeze(controllers), providers: Object.freeze(providers),
    }));
  }

  for (const controller of analysis.controllers.values()) {
    if (!controllerOwners.has(controller.name)) add(diagnostics, DiagnosticCode.MISSING_GRAPH, `Controller "${controller.name}" is not owned by a Graph.`, controller, [controller.name]);
  }
  for (const provider of analysis.providers.values()) {
    if (provider.provide === "graph" && !providerOwners.has(provider.name)) add(diagnostics, DiagnosticCode.MISSING_GRAPH, `Graph provider "${provider.name}" is not owned by a Graph.`, provider, [provider.name]);
  }

  validateDependencies(result, rootProviders, providerOwners, tokenNames, diagnostics);
  return Object.freeze({ version: 1, projectRoot, graphs: Object.freeze(result), rootProviders: Object.freeze([...rootProviders.values()]) });
}

function validateRoutes(graph: AnalyzedGraph, controllers: readonly ControllerWIR[], diagnostics: CompilerDiagnostic[]): void {
  const routes = new Map<string, ControllerWIR>();
  for (const controller of controllers) for (const route of controller.routes) {
    const path = joinPath(graph.prefix, controller.prefix, route.path);
    const key = `${route.method} ${path}`;
    const prior = routes.get(key);
    if (prior !== undefined) add(diagnostics, DiagnosticCode.DUPLICATE_ROUTE, `Duplicate Route\n\n${key}`, route, [prior.name, controller.name]);
    else routes.set(key, controller);
  }
}
function validateSocketEvents(controllers: readonly ControllerWIR[], diagnostics: CompilerDiagnostic[]): void {
  for (const controller of controllers) {
    const events = new Set<string>();
    for (const event of controller.socketEvents) {
      const key = `${event.kind}:${event.event}`;
      if (events.has(key)) add(diagnostics, DiagnosticCode.DUPLICATE_SOCKET_EVENT, `Duplicate socket ${event.kind} "${event.event}" in "${controller.name}".`, event, [controller.name, event.event]);
      else events.add(key);
    }
  }
}
function validateDependencies(graphs: readonly GraphWIR[], roots: ReadonlyMap<string, ProviderWIR>, owners: ReadonlyMap<string, AnalyzedGraph>, tokenNames: ReadonlyMap<string, string>, diagnostics: CompilerDiagnostic[]): void {
  for (const graph of graphs) {
    const local = new Map(graph.providers.map((provider) => [provider.name, provider]));
    for (const provider of [...graph.providers, ...roots.values()]) for (const rawDependency of provider.dependencies) {
      const dependency = tokenNames.get(rawDependency) ?? rawDependency;
      if (roots.has(dependency) || (provider.provide === "graph" && local.has(dependency))) continue;
      const owner = owners.get(dependency);
      if (owner !== undefined) add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Provider "${dependency}" is scoped to Graph "${owner.name}" and cannot be injected into "${graph.name}". Declare provide: ProviderScope.ROOT if the provider should be globally available.`, provider, [provider.name, dependency, owner.name, graph.name]);
      else add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Provider "${provider.name}" depends on unknown provider "${dependency}".`, provider, [provider.name, dependency]);
    }
    detectCycles([...graph.providers, ...roots.values()], tokenNames, diagnostics);
  }
}
function detectCycles(providers: readonly ProviderWIR[], tokenNames: ReadonlyMap<string, string>, diagnostics: CompilerDiagnostic[]): void {
  const table = new Map(providers.map((provider) => [provider.name, provider]));
  const state = new Map<string, 0 | 1 | 2>();
  for (const provider of providers) {
    if ((state.get(provider.name) ?? 0) !== 0) continue;
    const stack: Array<{ name: string; next: number }> = [{ name: provider.name, next: 0 }];
    state.set(provider.name, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const current = table.get(frame.name)!;
      if (frame.next >= current.dependencies.length) { state.set(frame.name, 2); stack.pop(); continue; }
      const rawDependency = current.dependencies[frame.next++]!;
      const dependency = tokenNames.get(rawDependency) ?? rawDependency;
      if (!table.has(dependency)) continue;
      const dependencyState = state.get(dependency) ?? 0;
      if (dependencyState === 1) {
        const start = stack.findIndex((item) => item.name === dependency);
        const cycle = [...stack.slice(start).map((item) => item.name), dependency];
        add(diagnostics, DiagnosticCode.DEPENDENCY_CYCLE, `Provider dependency cycle: ${cycle.join(" -> ")}`, current, cycle);
      } else if (dependencyState === 0) {
        state.set(dependency, 1); stack.push({ name: dependency, next: 0 });
      }
    }
  }
}
function normalizePath(path: string): string {
  if (path === "" || path === "/") return "";
  const value = path.startsWith("/") ? path : `/${path}`;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
function joinPath(...parts: readonly string[]): string {
  const joined = parts.map(normalizePath).filter(Boolean).join("");
  return joined === "" ? "/" : joined;
}
function copyLocation(location: SourceLocationWIR): SourceLocationWIR { return { file: location.file, line: location.line, column: location.column }; }
function add(output: CompilerDiagnostic[], code: string, message: string, location: SourceLocationWIR, relatedSymbols: readonly string[]): void {
  output.push(Object.freeze({ code, category: "error", message, sourceFile: location.file, line: location.line, column: location.column, relatedSymbols: Object.freeze([...relatedSymbols]) }));
}
