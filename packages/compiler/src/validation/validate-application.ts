import type { AnalysisResult, AnalyzedGraph } from "../analyzer/analyze-program";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostic";
import type { ApplicationWIR, ControllerWIR, EventListenerWIR, GraphWIR, ProviderWIR, SourceLocationWIR } from "../wir/wir";

/** Validates analyzed declarations and produces immutable metadata-only WIR. */
export function validateApplication(projectRoot: string, analysis: AnalysisResult, diagnostics: CompilerDiagnostic[]): ApplicationWIR {
  const graphNames = new Map<string, AnalyzedGraph>();
  const controllerOwners = new Map<string, AnalyzedGraph>();
  const providerOwners = new Map<string, AnalyzedGraph>();
  const controllerProviderOwners = new Map<string, string>();
  const controllerScopedProviderNames = new Set<string>();
  const rootProviders = new Map<string, ProviderWIR>();
  const result: GraphWIR[] = [];

  /** Resolves a `provide:` token alias back to the provider's canonical WIR name. */
  const tokenNames = new Map<string, string>();
  for (const provider of analysis.providers.values()) if (provider.token !== undefined) tokenNames.set(provider.token, provider.name);
  for (const provider of analysis.frameworkProviders) rootProviders.set(provider.local, Object.freeze({
    file: provider.module,
    line: provider.line,
    column: provider.column,
    name: provider.local,
    kind: "injectable",
    provide: "root",
    registration: "class",
    implementation: provider.imported,
    dependencies: Object.freeze([]),
  }));

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
      const controllerProviders: ProviderWIR[] = [];
      const localControllerProviderNames = new Set<string>();
      for (const providerName of controller.providerNames) {
        const provider = analysis.providers.get(providerName);
        if (provider === undefined) {
          add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Controller "${controller.name}" references unknown provider "${providerName}".`, controller, [controller.name, providerName]);
          continue;
        }
        if (localControllerProviderNames.has(providerName)) {
          add(diagnostics, DiagnosticCode.DUPLICATE_PROVIDER, `Controller "${controller.name}" declares provider "${providerName}" more than once.`, provider, [controller.name, providerName]);
          continue;
        }
        localControllerProviderNames.add(providerName);
        if (provider.provide === "root") continue;
        if (provider.provide === "request") {
          add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Controller provider "${provider.name}" cannot be request-scoped. Request-scoped providers must be declared at Graph scope.`, provider, [controller.name, provider.name]);
          continue;
        }
        const scoped = provider.provide === "controller" ? provider : controllerScopedProvider(provider);
        controllerProviders.push(scoped);
        controllerScopedProviderNames.add(provider.name);
        controllerProviderOwners.set(`${controller.name}:${provider.name}`, graph.name);
      }
      controllers.push(Object.freeze({
        ...copyLocation(controller), name: controller.name, kind: controller.kind, prefix: controller.prefix,
        ...(controller.synthetic === true ? { synthetic: true } : {}),
        middleware: controller.middleware,
        providerNames: controller.providerNames,
        providers: Object.freeze(controllerProviders), dependencies: controller.dependencies, routes: controller.routes, socketEvents: controller.socketEvents,
      }));
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
      if (provider.provide === "graph" || provider.provide === "request") {
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
      middleware: graph.middleware,
      controllers: Object.freeze(controllers), providers: Object.freeze(providers),
    }));
  }

  for (const controller of analysis.controllers.values()) {
    if (!controllerOwners.has(controller.name)) add(diagnostics, DiagnosticCode.MISSING_GRAPH, `Controller "${controller.name}" is not owned by a Graph.`, controller, [controller.name]);
  }
  for (const provider of analysis.providers.values()) {
    if ((provider.provide === "graph" || provider.provide === "request") && !providerOwners.has(provider.name) && !controllerScopedProviderNames.has(provider.name)) {
      add(diagnostics, DiagnosticCode.MISSING_GRAPH, `Graph provider "${provider.name}" is not owned by a Graph.`, provider, [provider.name]);
    }
  }

  validateDependencies(result, rootProviders, providerOwners, controllerProviderOwners, diagnostics);
  validateEvents(analysis, diagnostics);
  validateRouteNames(result, diagnostics);
  return Object.freeze({
    version: 1,
    projectRoot,
    transports: Object.freeze(analysis.transports),
    middleware: analysis.middleware,
    graphs: Object.freeze(result),
    rootProviders: Object.freeze([...rootProviders.values()]),
    events: Object.freeze([...analysis.events.values()]),
    eventListeners: Object.freeze([...analysis.eventListeners.values()]),
    eventInterceptors: Object.freeze([...analysis.eventInterceptors.values()]),
  });
}

function controllerScopedProvider(provider: ProviderWIR): ProviderWIR {
  return Object.freeze({
    ...copyLocation(provider),
    name: provider.name,
    kind: provider.kind,
    provide: "controller",
    ...(provider.token === undefined ? {} : { token: provider.token }),
    registration: provider.registration,
    ...(provider.implementation === undefined ? {} : { implementation: provider.implementation }),
    ...(provider.capturedValue === undefined ? {} : { capturedValue: provider.capturedValue }),
    ...(provider.capturedFactory === undefined ? {} : { capturedFactory: provider.capturedFactory }),
    ...(provider.existing === undefined ? {} : { existing: provider.existing }),
    dependencies: provider.dependencies,
  });
}

/** Route `name`s are a single application-wide namespace (`route("users.show")`), not per-graph. */
function validateRouteNames(graphs: readonly GraphWIR[], diagnostics: CompilerDiagnostic[]): void {
  const names = new Map<string, string>();
  for (const graph of graphs) for (const controller of graph.controllers) for (const route of controller.routes) {
    if (route.name === undefined) continue;
    const prior = names.get(route.name);
    if (prior !== undefined) {
      add(diagnostics, DiagnosticCode.DUPLICATE_ROUTE_NAME, `Duplicate route name "${route.name}".`, route, [prior, controller.name]);
      continue;
    }
    names.set(route.name, controller.name);
  }
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
function validateDependencies(
  graphs: readonly GraphWIR[],
  roots: ReadonlyMap<string, ProviderWIR>,
  owners: ReadonlyMap<string, AnalyzedGraph>,
  controllerOwners: ReadonlyMap<string, string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const rootTokens = providerTokenNames(roots);
  for (const graph of graphs) {
    const graphProviders = new Map(graph.providers.map((provider) => [provider.name, provider]));
    const graphTokens = providerTokenNames(graphProviders);
    for (const provider of roots.values()) validateProviderDependencies(provider, graph.name, roots, graphProviders, undefined, rootTokens, graphTokens, undefined, owners, controllerOwners, diagnostics);
    for (const provider of graph.providers) validateProviderDependencies(provider, graph.name, roots, graphProviders, undefined, rootTokens, graphTokens, undefined, owners, controllerOwners, diagnostics);
    detectCycles([...graph.providers, ...roots.values()], visibleTokenNames(rootTokens, graphTokens, undefined), diagnostics);
    for (const controller of graph.controllers) {
      const controllerProviders = new Map(controller.providers.map((provider) => [provider.name, provider]));
      const controllerTokens = providerTokenNames(controllerProviders);
      for (const provider of controller.providers) {
        validateProviderDependencies(provider, graph.name, roots, graphProviders, controllerProviders, rootTokens, graphTokens, controllerTokens, owners, controllerOwners, diagnostics);
      }
      validateControllerDependencies(controller, graph.name, roots, graphProviders, controllerProviders, rootTokens, graphTokens, controllerTokens, owners, controllerOwners, diagnostics);
      detectCycles([...controller.providers, ...graph.providers, ...roots.values()], visibleTokenNames(rootTokens, graphTokens, controllerTokens), diagnostics);
    }
  }
}

function validateControllerDependencies(
  controller: ControllerWIR,
  graphName: string,
  roots: ReadonlyMap<string, ProviderWIR>,
  graphProviders: ReadonlyMap<string, ProviderWIR>,
  controllerProviders: ReadonlyMap<string, ProviderWIR>,
  rootTokens: ReadonlyMap<string, string>,
  graphTokens: ReadonlyMap<string, string>,
  controllerTokens: ReadonlyMap<string, string>,
  owners: ReadonlyMap<string, AnalyzedGraph>,
  controllerOwners: ReadonlyMap<string, string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const tokens = visibleTokenNames(rootTokens, graphTokens, controllerTokens);
  for (const rawDependency of controller.dependencies) {
    const dependency = tokens.get(rawDependency) ?? rawDependency;
    const resolved = controllerProviders.get(dependency) ?? graphProviders.get(dependency) ?? roots.get(dependency);
    if (resolved !== undefined) {
      if (resolved.provide === "request") add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Controller "${controller.name}" cannot depend on request-scoped provider "${dependency}".`, controller, [controller.name, dependency]);
      continue;
    }
    const owner = owners.get(dependency);
    if (owner !== undefined) {
      add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Provider "${dependency}" is scoped to Graph "${owner.name}" and cannot be injected into "${graphName}". Declare provide: ProviderScope.ROOT if the provider should be globally available.`, controller, [controller.name, dependency, owner.name, graphName]);
      continue;
    }
    const controllerOwner = controllerOwnerFor(dependency, controllerOwners);
    if (controllerOwner !== undefined) {
      add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Controller provider "${dependency}" is scoped to "${controllerOwner}" and cannot be injected into "${controller.name}".`, controller, [controller.name, dependency, controllerOwner]);
      continue;
    }
    add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Controller "${controller.name}" depends on unknown provider "${dependency}".`, controller, [controller.name, dependency]);
  }
}

function validateProviderDependencies(
  provider: ProviderWIR,
  graphName: string,
  roots: ReadonlyMap<string, ProviderWIR>,
  graphProviders: ReadonlyMap<string, ProviderWIR>,
  controllerProviders: ReadonlyMap<string, ProviderWIR> | undefined,
  rootTokens: ReadonlyMap<string, string>,
  graphTokens: ReadonlyMap<string, string>,
  controllerTokens: ReadonlyMap<string, string> | undefined,
  owners: ReadonlyMap<string, AnalyzedGraph>,
  controllerOwners: ReadonlyMap<string, string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const tokens = visibleTokenNames(rootTokens, graphTokens, controllerTokens);
  for (const rawDependency of provider.dependencies) {
    const dependency = tokens.get(rawDependency) ?? rawDependency;
    const resolved = controllerProviders?.get(dependency) ?? graphProviders.get(dependency) ?? roots.get(dependency);
    if (resolved !== undefined) {
      if ((provider.provide === "root" || provider.provide === "controller") && resolved.provide === "request") {
        add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Startup-scoped provider "${provider.name}" cannot depend on request-scoped provider "${dependency}".`, provider, [provider.name, dependency]);
      }
      continue;
    }
    const owner = owners.get(dependency);
    if (owner !== undefined) {
      add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Provider "${dependency}" is scoped to Graph "${owner.name}" and cannot be injected into "${graphName}". Declare provide: ProviderScope.ROOT if the provider should be globally available.`, provider, [provider.name, dependency, owner.name, graphName]);
      continue;
    }
    const controllerOwner = controllerOwnerFor(dependency, controllerOwners);
    if (controllerOwner !== undefined) {
      add(diagnostics, DiagnosticCode.PROVIDER_VISIBILITY, `Controller provider "${dependency}" is scoped to "${controllerOwner}" and cannot be injected here.`, provider, [provider.name, dependency, controllerOwner]);
      continue;
    }
    add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Provider "${provider.name}" depends on unknown provider "${dependency}".`, provider, [provider.name, dependency]);
  }
}

function providerTokenNames(providers: ReadonlyMap<string, ProviderWIR>): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const provider of providers.values()) if (provider.token !== undefined) result.set(provider.token, provider.name);
  return result;
}
function visibleTokenNames(
  rootTokens: ReadonlyMap<string, string>,
  graphTokens: ReadonlyMap<string, string>,
  controllerTokens: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of rootTokens) result.set(key, value);
  for (const [key, value] of graphTokens) result.set(key, value);
  if (controllerTokens !== undefined) for (const [key, value] of controllerTokens) result.set(key, value);
  return result;
}
function controllerOwnerFor(providerName: string, owners: ReadonlyMap<string, string>): string | undefined {
  for (const key of owners.keys()) {
    const index = key.indexOf(":");
    if (index >= 0 && key.slice(index + 1) === providerName) return key.slice(0, index);
  }
  return undefined;
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
function validateEvents(analysis: AnalysisResult, diagnostics: CompilerDiagnostic[]): void {
  const events = analysis.events;
  for (const listener of analysis.eventListeners.values()) {
    if (!events.has(listener.event)) add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Event listener "${listener.name}" references unknown event "${listener.event}".`, listener, [listener.name, listener.event]);
    for (const edge of listener.dispatches) {
      if (!events.has(edge.event)) add(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Event listener "${listener.name}" dispatches unknown event "${edge.event}".`, edge, [listener.name, edge.event]);
    }
  }
  const byEvent = new Map<string, EventListenerWIR[]>();
  for (const listener of analysis.eventListeners.values()) {
    const current = byEvent.get(listener.event) ?? [];
    current.push(listener);
    byEvent.set(listener.event, current);
  }
  for (const event of events.values()) detectEventCycles(event.key, byEvent, diagnostics);
}
function detectEventCycles(start: string, listeners: ReadonlyMap<string, readonly EventListenerWIR[]>, diagnostics: CompilerDiagnostic[]): void {
  const stack: Array<Readonly<{ readonly event: string; readonly via?: EventListenerWIR; readonly conditional: boolean }>> = [Object.freeze({ event: start, conditional: false })];
  const walk = (eventName: string, path: typeof stack, depth: number): void => {
    if (depth > 16) return;
    for (const listener of listeners.get(eventName) ?? []) {
      for (const edge of listener.dispatches) {
        const conditional = path.some((item) => item.conditional) || !edge.unconditional;
        const nextPath = [...path, Object.freeze({ event: edge.event, via: listener, conditional })];
        if (edge.event === start) {
          const names = nextPath.flatMap((item, index) => index === 0 ? [item.event] : [item.via?.name ?? "listener", item.event]);
          const message = `Event dispatch cycle: ${names.join(" -> ")}`;
          if (conditional) warn(diagnostics, DiagnosticCode.DEPENDENCY_CYCLE, message, edge, names);
          else add(diagnostics, DiagnosticCode.DEPENDENCY_CYCLE, message, edge, names);
          continue;
        }
        if (!path.some((item) => item.event === edge.event)) walk(edge.event, nextPath, depth + 1);
      }
    }
  };
  walk(start, stack, 0);
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
function warn(output: CompilerDiagnostic[], code: string, message: string, location: SourceLocationWIR, relatedSymbols: readonly string[]): void {
  output.push(Object.freeze({ code, category: "warning", message, sourceFile: location.file, line: location.line, column: location.column, relatedSymbols: Object.freeze([...relatedSymbols]) }));
}
