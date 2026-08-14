import { RouteFlag, SocketFlag } from "../flags/flags";
import type { NamedTableEntry, OptimizedApplication, ProviderTableEntry, RouteTableEntry, SocketTableEntry } from "../output/artifact-types";
import type { ApplicationWIR, RouteWIR, SocketEventWIR } from "../wir/wir";

/** Normalizes WIR into deterministic IDs and immutable dense lookup tables. */
export function optimizeWIR(wir: ApplicationWIR): OptimizedApplication {
  const graphKeys = wir.graphs.map((graph) => graph.name).sort(compare);
  const graphIds = idRecord(graphKeys);
  const providerRows = [
    ...wir.rootProviders.map((provider) => ({ key: `root:${provider.name}`, graph: "", provider })),
    ...wir.graphs.flatMap((graph) => graph.providers.map((provider) => ({ key: `${graph.name}:${provider.name}`, graph: graph.name, provider }))),
  ].sort((left, right) => compare(left.key, right.key));
  const controllerRows = wir.graphs.flatMap((graph) => graph.controllers.map((controller) => ({ key: `${graph.name}:${controller.name}`, graph: graph.name, controller }))).sort((left, right) => compare(left.key, right.key));
  const routeRows = wir.graphs.flatMap((graph) => graph.controllers.flatMap((controller) => controller.routes.map((route) => ({
    key: `${graph.name}:${route.method}:${joinPath(graph.prefix, controller.prefix, route.path)}:${controller.name}.${route.handler}`,
    graph: graph.name, controller: controller.name, path: joinPath(graph.prefix, controller.prefix, route.path), route,
  })))).sort((left, right) => compare(left.key, right.key));
  const socketRows = wir.graphs.flatMap((graph) => graph.controllers.flatMap((controller) => controller.socketEvents.map((event) => ({
    key: `${graph.name}:${controller.name}:${event.kind}:${event.event}:${event.handler}`, graph: graph.name, controller: controller.name, event,
  })))).sort((left, right) => compare(left.key, right.key));
  const eventRows = wir.events.map((event) => ({ key: `${event.file}:${event.name}`, event })).sort((left, right) => compare(left.key, right.key));
  const eventIds = idMap(eventRows.map((row) => row.event.key));
  const listenerRows = wir.eventListeners.map((listener) => ({ key: `${listener.file}:${listener.name}`, listener })).sort((left, right) => compare(left.key, right.key));
  const interceptorRows = wir.eventInterceptors.map((interceptor) => ({ key: `${interceptor.file}:${interceptor.name}`, interceptor })).sort((left, right) => compare(left.key, right.key));

  const providerIds = idMap(providerRows.map((row) => row.key));
  const tokenNames = new Map<string, string>();
  for (const provider of wir.rootProviders) if (provider.token !== undefined) tokenNames.set(provider.token, provider.name);
  for (const graph of wir.graphs) for (const provider of graph.providers) if (provider.token !== undefined) tokenNames.set(provider.token, provider.name);
  const controllerIds = idMap(controllerRows.map((row) => row.key));
  const handlerNames = uniqueSorted([
    ...routeRows.map((row) => `${row.graph}:${row.controller}.${row.route.handler}`),
    ...socketRows.map((row) => `${row.graph}:${row.controller}.${row.event.handler}`),
  ]);
  const validatorNames = uniqueSorted([...routeRows.map((row) => row.route.validator), ...socketRows.map((row) => row.event.validator)].filter(isString));
  const middlewareNames = uniqueSorted([...routeRows.flatMap((row) => row.route.middleware), ...socketRows.flatMap((row) => row.event.middleware)]);
  const guardNames = uniqueSorted([...routeRows.flatMap((row) => row.route.guards), ...socketRows.flatMap((row) => row.event.guards)]);
  const handlerIds = idMap(handlerNames);
  const validatorIds = idMap(validatorNames);
  const middlewareIds = idMap(middlewareNames);
  const guardIds = idMap(guardNames);

  const strings = uniqueSorted([
    ...graphKeys,
    ...providerRows.flatMap((row) => [row.provider.name, ...row.provider.dependencies]),
    ...controllerRows.map((row) => row.controller.name),
    ...eventRows.flatMap((row) => [row.event.name, row.event.file]),
    ...listenerRows.flatMap((row) => [row.listener.name, row.listener.file]),
    ...interceptorRows.flatMap((row) => [row.interceptor.name, row.interceptor.file]),
    ...routeRows.flatMap((row) => [row.route.method, row.path, row.route.handler, ...(row.route.name === undefined ? [] : [row.route.name])]),
    ...socketRows.flatMap((row) => [row.event.event, row.event.handler]),
    ...handlerNames, ...validatorNames, ...middlewareNames, ...guardNames,
  ]);
  const stringIds = idMap(strings);

  const providerDependencies: number[] = [];
  const providers: ProviderTableEntry[] = providerRows.map((row) => {
    const dependencyStart = providerDependencies.length;
    for (const rawDependency of unique(row.provider.dependencies)) {
      const dependency = tokenNames.get(rawDependency) ?? rawDependency;
      const rootKey = `root:${dependency}`;
      const localKey = `${row.graph}:${dependency}`;
      providerDependencies.push(providerIds.get(localKey) ?? providerIds.get(rootKey) ?? -1);
    }
    return Object.freeze({
      id: providerIds.get(row.key)!, nameId: stringIds.get(row.provider.name)!,
      graphId: row.graph === "" ? -1 : graphIds[row.graph]!, scope: row.provider.provide,
      dependencyStart, dependencyCount: providerDependencies.length - dependencyStart,
    });
  });
  const controllers = controllerRows.map((row) => Object.freeze({
    id: controllerIds.get(row.key)!, nameId: stringIds.get(row.controller.name)!, graphId: graphIds[row.graph]!,
    websocket: row.controller.kind === "websocket",
  }));
  const routeMiddleware: number[] = [];
  const routeGuards: number[] = [];
  const routes: RouteTableEntry[] = routeRows.map((row, id) => {
    const middlewareStart = appendIds(routeMiddleware, row.route.middleware, middlewareIds);
    const guardStart = appendIds(routeGuards, row.route.guards, guardIds);
    return Object.freeze({
      id, methodId: stringIds.get(row.route.method)!, pathId: stringIds.get(row.path)!,
      controllerId: controllerIds.get(`${row.graph}:${row.controller}`)!,
      handlerId: handlerIds.get(`${row.graph}:${row.controller}.${row.route.handler}`)!,
      validatorId: row.route.validator === undefined ? -1 : validatorIds.get(row.route.validator)!,
      nameId: row.route.name === undefined ? -1 : stringIds.get(row.route.name)!,
      middlewareStart, middlewareCount: routeMiddleware.length - middlewareStart,
      guardStart, guardCount: routeGuards.length - guardStart, flags: routeFlags(row.route),
    });
  });
  const socketMiddleware: number[] = [];
  const socketGuards: number[] = [];
  const socketEvents: SocketTableEntry[] = socketRows.map((row, id) => {
    const middlewareStart = appendIds(socketMiddleware, row.event.middleware, middlewareIds);
    const guardStart = appendIds(socketGuards, row.event.guards, guardIds);
    return Object.freeze({
      id, eventId: stringIds.get(row.event.event)!, controllerId: controllerIds.get(`${row.graph}:${row.controller}`)!,
      handlerId: handlerIds.get(`${row.graph}:${row.controller}.${row.event.handler}`)!,
      validatorId: row.event.validator === undefined ? -1 : validatorIds.get(row.event.validator)!,
      middlewareStart, middlewareCount: socketMiddleware.length - middlewareStart,
      guardStart, guardCount: socketGuards.length - guardStart, flags: socketFlags(row.event),
      lifecycle: row.event.kind === "lifecycle",
    });
  });
  const named = (names: readonly string[], ids: ReadonlyMap<string, number>): readonly NamedTableEntry[] =>
    Object.freeze(names.map((name) => Object.freeze({ id: ids.get(name)!, nameId: stringIds.get(name)! })));
  const eventListeners = listenerRows.map((row, id) => Object.freeze({
    id,
    nameId: stringIds.get(row.listener.name)!,
    eventId: eventIds.get(row.listener.event) ?? -1,
    fileId: stringIds.get(row.listener.file)!,
    line: row.listener.line,
    column: row.listener.column,
  }));
  const eventListenerIds: number[] = [];
  for (const event of eventRows) for (const listener of eventListeners.filter((item) => item.eventId === eventIds.get(event.event.key)!)) eventListenerIds.push(listener.id);
  return Object.freeze({
    strings: Object.freeze(strings), graphIds: Object.freeze(graphIds),
    providers: Object.freeze(providers), providerDependencies: Object.freeze(providerDependencies),
    controllers: Object.freeze(controllers), routes: Object.freeze(routes), socketEvents: Object.freeze(socketEvents),
    handlers: named(handlerNames, handlerIds), validators: named(validatorNames, validatorIds),
    middlewares: named(middlewareNames, middlewareIds), guards: named(guardNames, guardIds),
    events: Object.freeze(eventRows.map((row) => Object.freeze({
      id: eventIds.get(row.event.key)!,
      nameId: stringIds.get(row.event.name)!,
      fileId: stringIds.get(row.event.file)!,
      line: row.event.line,
      column: row.event.column,
    }))),
    eventListeners: Object.freeze(eventListeners),
    eventInterceptors: Object.freeze(interceptorRows.map((row, id) => Object.freeze({
      id,
      nameId: stringIds.get(row.interceptor.name)!,
      fileId: stringIds.get(row.interceptor.file)!,
      line: row.interceptor.line,
      column: row.interceptor.column,
    }))),
    eventListenerIds: Object.freeze(eventListenerIds),
    routeMiddleware: Object.freeze(routeMiddleware), routeGuards: Object.freeze(routeGuards),
    socketMiddleware: Object.freeze(socketMiddleware), socketGuards: Object.freeze(socketGuards),
  });
}

function routeFlags(route: RouteWIR): number {
  const method = RouteFlag[route.method as keyof typeof RouteFlag] ?? 0;
  return method |
    (route.validator === undefined ? 0 : RouteFlag.VALIDATION) |
    (route.middleware.length === 0 ? 0 : RouteFlag.MIDDLEWARE) |
    (route.guards.length === 0 ? 0 : RouteFlag.GUARD) |
    (route.csrf ? RouteFlag.CSRF : 0) |
    (route.stream === undefined ? 0 : RouteFlag.STREAMING) |
    (route.response === "static" ? RouteFlag.STATIC : 0) |
    (route.response === "view" ? RouteFlag.VIEW : 0) |
    (route.response === "json" ? RouteFlag.JSON : 0) |
    (route.response === "html" ? RouteFlag.HTML : 0) |
    (route.viewContext ? RouteFlag.VIEW_CONTEXT : 0);
}
function socketFlags(event: SocketEventWIR): number {
  return (event.validator === undefined ? 0 : SocketFlag.VALIDATION) |
    (event.middleware.length === 0 ? 0 : SocketFlag.MIDDLEWARE) |
    (event.guards.length === 0 ? 0 : SocketFlag.GUARD) |
    (event.compression ? SocketFlag.COMPRESSION : 0) |
    (event.binary ? SocketFlag.BINARY : 0) |
    (event.authentication ? SocketFlag.AUTHENTICATION : 0) |
    (event.rateLimit ? SocketFlag.RATE_LIMIT : 0);
}
function appendIds(target: number[], names: readonly string[], ids: ReadonlyMap<string, number>): number {
  const start = target.length;
  for (const name of unique(names)) target.push(ids.get(name)!);
  return start;
}
function idMap(values: readonly string[]): ReadonlyMap<string, number> { return new Map(values.map((value, index) => [value, index])); }
function idRecord(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = Object.create(null);
  values.forEach((value, index) => { result[value] = index; });
  return result;
}
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
function uniqueSorted(values: readonly string[]): string[] { return unique(values).sort(compare); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isString(value: string | undefined): value is string { return value !== undefined; }
function normalizePath(path: string): string { const value = path === "" || path === "/" ? "" : path.startsWith("/") ? path : `/${path}`; return value.endsWith("/") ? value.slice(0, -1) : value; }
function joinPath(...parts: readonly string[]): string { const value = parts.map(normalizePath).filter(Boolean).join(""); return value === "" ? "/" : value; }
