import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { BindingImport, ContextEntryBindingPlan, ExecutableBindingPlan, ProviderBindingPlan, TokenReference } from "../bindings";
import type { GeneratedApplication, OptimizedApplication } from "../output/artifact-types";

/** Generates deterministic executable TypeScript artifacts from optimized tables. */
export function generateArtifacts(
  optimized: OptimizedApplication,
  bindings?: ExecutableBindingPlan,
  contextEntries: readonly ContextEntryBindingPlan[] = [],
): GeneratedApplication {
  const files: Record<string, string> = {
    "tables.generated.ts": tablesSource(optimized),
    "routes.generated.ts": routesSource(optimized),
    "socket.generated.ts": socketSource(optimized),
    "events.generated.ts": eventsSource(optimized, bindings),
    "events.manifest.json": eventsManifestSource(optimized),
    "providers.generated.ts": bindings === undefined ? providersSource() : executableProvidersSource(bindings),
    // Pure type-level: unlike every other file here, this has no runtime import/export
    // and exists purely to declaration-merge into @warbler/http's WarblerRequestContext.
    "context.generated.d.ts": contextTypesSource(contextEntries),
  };
  if (bindings !== undefined) {
    if (bindings.controllers.length > 0) files["controllers.generated.ts"] = controllersSource(bindings);
    if (bindings.handlers.length > 0) files["handlers.generated.ts"] = handlersSource(bindings);
    if (bindings.guards.length > 0) files["guards.generated.ts"] = executableValuesSource("guardBindings", "execute", bindings.guards);
    if (bindings.middlewares.length > 0) files["middleware.generated.ts"] = executableValuesSource("middlewareBindings", "execute", bindings.middlewares);
    if (bindings.validators.length > 0) files["validators.generated.ts"] = validatorsSource(bindings.validators);
    if (optimized.routes.length > 0) files["http.generated.ts"] = httpBindingsSource(optimized);
    if (optimized.socketEvents.length > 0) files["websocket.generated.ts"] = websocketBindingsSource(optimized);
    files["bindings.generated.ts"] = bindingsSource(bindings, optimized);
    files["production.generated.ts"] = productionSource();
  }
  files["application.generated.ts"] = applicationSource(bindings, optimized);
  return Object.freeze({ optimized, ...(bindings === undefined ? {} : { bindings }), files: Object.freeze(files) });
}

/** Writes generated artifacts in stable filename order. */
export interface DevelopmentArtifactSnapshot {
  readonly fingerprint: string;
  readonly sources: readonly Readonly<{ file: string; text: string }>[];
}
export async function writeArtifacts(projectRoot: string, generated: GeneratedApplication, snapshot?: DevelopmentArtifactSnapshot): Promise<void> {
  const outputDirectory = `${projectRoot}/.warbler/generated`;
  await mkdir(outputDirectory, { recursive: true });
  const current = new Set(Object.keys(generated.files));
  for (const name of await readdir(outputDirectory)) {
    if ((name.endsWith(".generated.ts") || name.endsWith(".generated.d.ts")) && !current.has(name)) await unlink(`${outputDirectory}/${name}`);
  }
  for (const name of Object.keys(generated.files).sort()) await writeIfChanged(`${outputDirectory}/${name}`, generated.files[name]!);
  await removeLegacyWarblerEnvFile(projectRoot);
  if (snapshot !== undefined) await writeRuntimeSnapshot(projectRoot, generated, snapshot);
}
/** Writes one fingerprinted runtime build snapshot without touching stable generated metadata files. */
export async function writeRuntimeSnapshot(projectRoot: string, generated: GeneratedApplication, snapshot: DevelopmentArtifactSnapshot): Promise<void> {
  const outputDirectory = `${projectRoot}/.warbler/generated`;
  const snapshotDirectory = `${outputDirectory}/build-${snapshot.fingerprint}`;
  await mkdir(snapshotDirectory, { recursive: true });
  for (const source of snapshot.sources) {
    const relativeSource = relative(projectRoot, source.file).replaceAll("\\", "/");
    const destination = `${snapshotDirectory}/source/${relativeSource}`;
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, source.text);
  }
  for (const name of Object.keys(generated.files).sort()) {
    await Bun.write(`${snapshotDirectory}/${name}`, snapshotGeneratedSource(generated.files[name]!, outputDirectory, projectRoot));
  }
}
async function writeIfChanged(path: string, content: string): Promise<void> {
  const file = Bun.file(path);
  if (await file.exists() && await file.text() === content) return;
  await Bun.write(path, content);
}
async function removeLegacyWarblerEnvFile(projectRoot: string): Promise<void> {
  try { await unlink(`${projectRoot}/warbler-env.d.ts`); }
  catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return;
    throw cause;
  }
}
function snapshotGeneratedSource(source: string, generatedDirectory: string, projectRoot: string): string {
  return source.replace(/from ("[^"]+"|'[^']+')/gu, (match, quoted: string) => {
    const module = quoted.slice(1, -1);
    if (!module.startsWith("../")) return match;
    const absolute = resolve(generatedDirectory, module);
    const projectRelative = relative(projectRoot, absolute).replaceAll("\\", "/");
    return `from ${JSON.stringify(`./source/${projectRelative}`)}`;
  });
}

function tablesSource(value: OptimizedApplication): string {
  return `/* Generated by @warbler/compiler. Do not edit. */
export const strings = ${frozenPrimitiveArray(value.strings)};
export const graphIds = Object.freeze(${JSON.stringify(value.graphIds)});
export const providerTable = ${frozenRows(value.providers)};
export const providerDependencies = ${frozenPrimitiveArray(value.providerDependencies)};
export const controllerTable = ${frozenRows(value.controllers)};
export const routeTable = ${frozenRows(value.routes)};
export const socketEventTable = ${frozenRows(value.socketEvents)};
export const handlerTable = ${frozenRows(value.handlers)};
export const validatorTable = ${frozenRows(value.validators)};
export const middlewareTable = ${frozenRows(value.middlewares)};
export const guardTable = ${frozenRows(value.guards)};
export const eventTable = ${frozenRows(value.events)};
export const eventListenerTable = ${frozenRows(value.eventListeners)};
export const eventInterceptorTable = ${frozenRows(value.eventInterceptors)};
export const eventListenerIds = ${frozenPrimitiveArray(value.eventListenerIds)};
export const routeMiddleware = ${frozenPrimitiveArray(value.routeMiddleware)};
export const routeGuards = ${frozenPrimitiveArray(value.routeGuards)};
export const socketMiddleware = ${frozenPrimitiveArray(value.socketMiddleware)};
export const socketGuards = ${frozenPrimitiveArray(value.socketGuards)};
`;
}
function routesSource(value: OptimizedApplication): string {
  const groups = new Map<number, typeof value.routes[number][]>();
  for (const route of value.routes) {
    const current = groups.get(route.pathId) ?? [];
    current.push(route);
    groups.set(route.pathId, current);
  }
  const paths = [...groups.entries()].sort((left, right) => left[0] - right[0]).map(([pathId, routes]) => {
    const methods = routes.map((route) => `      [strings[${route.methodId}]!]: handlers[${route.handlerId}]!,`).join("\n");
    return `    [strings[${pathId}]!]: Object.freeze({\n${methods}\n    }),`;
  }).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import { routeTable, strings } from "./tables.generated";
export type GeneratedRouteHandler = (request: Request) => Response | Promise<Response>;
export type GeneratedRoutes = Readonly<Record<string, Readonly<Record<string, GeneratedRouteHandler>>>>;
export function createRoutes(handlers: readonly GeneratedRouteHandler[]): GeneratedRoutes {
  if (handlers.length < ${value.handlers.length}) throw new RangeError("Missing generated route handlers.");
  return Object.freeze({
${paths}
  });
}
export const routeLookup = Object.freeze(Object.fromEntries(
  routeTable.map((route) => [\`\${strings[route.methodId]} \${strings[route.pathId]}\`, route.id]),
)) as Readonly<Record<string, number>>;
`;
}
function socketSource(value: OptimizedApplication): string {
  const groups = new Map<number, typeof value.socketEvents[number][]>();
  const lifecycleGroups = new Map<number, typeof value.socketEvents[number][]>();
  for (const event of value.socketEvents) {
    const target = event.lifecycle ? lifecycleGroups : groups;
    const current = target.get(event.controllerId) ?? [];
    current.push(event);
    target.set(event.controllerId, current);
  }
  const render = (source: ReadonlyMap<number, readonly typeof value.socketEvents[number][]>) => [...source.entries()].sort((left, right) => left[0] - right[0]).map(([controllerId, events]) => {
    const rows = events.map((event) => `      [strings[${event.eventId}]!]: handlers[${event.handlerId}]!,`).join("\n");
    return `    ${JSON.stringify(controllerId)}: Object.freeze({\n${rows}\n    }),`;
  }).join("\n");
  const controllers = render(groups);
  const lifecycles = render(lifecycleGroups);
  return `/* Generated by @warbler/compiler. Do not edit. */
import { strings } from "./tables.generated";
export type GeneratedSocketHandler = (message: unknown, context: unknown) => unknown;
export type GeneratedSocketDispatchers = Readonly<Record<number, Readonly<Record<string, GeneratedSocketHandler>>>>;
export function createSocketDispatchers(handlers: readonly GeneratedSocketHandler[]): GeneratedSocketDispatchers {
  if (handlers.length < ${value.handlers.length}) throw new RangeError("Missing generated socket handlers.");
  return Object.freeze({
${controllers}
  });
}
export function createSocketLifecycleHandlers(handlers: readonly GeneratedSocketHandler[]): GeneratedSocketDispatchers {
  if (handlers.length < ${value.handlers.length}) throw new RangeError("Missing generated socket handlers.");
  return Object.freeze({
${lifecycles}
  });
}
`;
}
function providersSource(): string {
  return `/* Generated by @warbler/compiler. Do not edit. */
import { providerDependencies, providerTable } from "./tables.generated";
export type GeneratedProviderFactory = (dependencies: readonly unknown[]) => unknown;
export interface GeneratedProviderResolver { resolve(providerId: number): unknown }
export function createProviderResolver(factories: readonly GeneratedProviderFactory[]): GeneratedProviderResolver {
  const instances: unknown[] = [];
  const created: boolean[] = [];
  const resolving = new Set<number>();
  const resolve = (providerId: number): unknown => {
    if (created[providerId]) return instances[providerId];
    const provider = providerTable[providerId];
    const factory = factories[providerId];
    if (provider === undefined || factory === undefined) throw new RangeError(\`Unknown generated provider: \${providerId}\`);
    if (resolving.has(providerId)) throw new Error(\`Generated provider cycle: \${providerId}\`);
    resolving.add(providerId);
    try {
      const dependencies = providerDependencies
        .slice(provider.dependencyStart, provider.dependencyStart + provider.dependencyCount)
        .map(resolve);
      const instance = factory(dependencies);
      instances[providerId] = instance;
      created[providerId] = true;
      return instance;
    } finally {
      resolving.delete(providerId);
    }
  };
  return Object.freeze({ resolve });
}
`;
}
function applicationSource(bindings: ExecutableBindingPlan | undefined, _optimized: OptimizedApplication): string {
  if (bindings !== undefined) {
    return `/* Generated by @warbler/compiler. Do not edit. */
export { applicationBindings as default, applicationBindings } from "./bindings.generated";
export * from "./bindings.generated";
`;
  }
  return `/* Generated by @warbler/compiler. Do not edit. */
export * from "./tables.generated";
export * from "./routes.generated";
export * from "./socket.generated";
export * from "./providers.generated";
`;
}
function frozenPrimitiveArray(values: readonly unknown[]): string { return `Object.freeze(${JSON.stringify(values)})`; }
function frozenRows(values: readonly object[]): string {
  return `Object.freeze([${values.map((value) => `Object.freeze(${JSON.stringify(value)})`).join(",")}])`;
}

function isTokenImport(token: TokenReference): token is BindingImport { return token.kind !== "literal"; }
function tokenExpression(token: TokenReference): string { return token.kind === "literal" ? token.expression : token.local; }
function isEventDispatcherBinding(binding: ProviderBindingPlan): boolean {
  return binding.registration === "class" && binding.implementation?.imported === "EventDispatcher" && binding.implementation.module === "@warbler/events";
}
function providerBindingImports(binding: ProviderBindingPlan): BindingImport[] {
  const values = [...binding.dependencySymbols];
  if (isTokenImport(binding.token)) values.push(binding.token);
  if (binding.implementation !== undefined) values.push(binding.implementation);
  if (binding.capturedValue !== undefined) values.push(...binding.capturedValue.imports);
  if (binding.capturedFactory !== undefined) values.push(...binding.capturedFactory.imports);
  if (binding.existing !== undefined && isTokenImport(binding.existing)) values.push(binding.existing);
  return values;
}
function providerFactoryExpression(binding: ProviderBindingPlan): string {
  if (binding.registration === "useValue") return `(context: ProviderBindingContext) => (${binding.capturedValue!.text})`;
  if (binding.registration === "useFactory") return `(context: ProviderBindingContext) => context.run(() => (${binding.capturedFactory!.text})())`;
  if (binding.registration === "useExisting") return `(context: ProviderBindingContext) => context.resolve(${tokenExpression(binding.existing!)})`;
  if (isEventDispatcherBinding(binding)) return `(context: ProviderBindingContext) => context.run(() => new ${binding.implementation!.local}(eventRuntimeBindings, { run: context.run, development: process.env.NODE_ENV !== "production" }))`;
  return `(context: ProviderBindingContext) => context.run(() => new ${binding.implementation!.local}())`;
}
function executableProvidersSource(bindings: ExecutableBindingPlan): string {
  const needsEvents = bindings.providers.some(isEventDispatcherBinding);
  const imports = [
    renderImports(bindings.providers.flatMap(providerBindingImports)),
    needsEvents ? `import { eventRuntimeBindings } from "./events.generated";` : "",
  ].filter(Boolean).join("\n");
  const rows = bindings.providers.map((binding) => `  Object.freeze({
    id: ${binding.id},
    token: ${tokenExpression(binding.token)},
    scope: ${JSON.stringify(binding.scope)},
    ${binding.scope === "graph" || binding.scope === "request" || binding.scope === "controller" ? `graphId: ${binding.graphId},\n    ` : ""}${binding.controllerId === undefined ? "" : `controllerId: ${binding.controllerId},\n    `}dependencyIds: Object.freeze(${JSON.stringify(binding.dependencyIds)}),
    factory: ${providerFactoryExpression(binding)},
  }),`).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import type { ProviderBinding, ProviderBindingContext } from "@warbler/runtime";
${imports}
export const providerBindings = Object.freeze([
${rows}
]) satisfies readonly ProviderBinding[];
${providersSource().replace("/* Generated by @warbler/compiler. Do not edit. */\n", "")}`;
}
function eventsSource(optimized: OptimizedApplication, bindings: ExecutableBindingPlan | undefined): string {
  if (bindings === undefined || (bindings.events.length === 0 && bindings.eventListeners.length === 0 && bindings.eventInterceptors.length === 0)) {
    return `/* Generated by @warbler/compiler. Do not edit. */
import type { EventRuntimeBindings } from "@warbler/events";
export const eventRuntimeBindings = Object.freeze({
  events: Object.freeze([]),
  listeners: Object.freeze([]),
  eventListeners: Object.freeze([]),
  interceptors: Object.freeze([]),
}) satisfies EventRuntimeBindings;
`;
  }
  const imports = renderImports([
    ...bindings.events,
    ...bindings.eventListeners,
    ...bindings.eventInterceptors,
  ]);
  const listenerGroups = optimized.events.map((event) => {
    const listenerIds = bindings.eventListeners.filter((listener) => listener.eventId === event.id).map((listener) => listener.id);
    return `  Object.freeze(${JSON.stringify(listenerIds)}),`;
  }).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import type { EventRuntimeBindings } from "@warbler/events";
${imports}
export const eventRuntimeBindings = Object.freeze({
  events: Object.freeze([
${bindings.events.map((binding) => `    Object.freeze({ id: ${binding.id}, event: ${binding.local}, debugName: ${JSON.stringify(binding.imported)}, file: ${JSON.stringify(binding.file)}, line: ${binding.line}, column: ${binding.column} }),`).join("\n")}
  ]),
  listeners: Object.freeze([
${bindings.eventListeners.map((binding) => `    Object.freeze({ id: ${binding.id}, eventId: ${binding.eventId}, listener: ${binding.local} }),`).join("\n")}
  ]),
  eventListeners: Object.freeze([
${listenerGroups}
  ]),
  interceptors: Object.freeze([
${bindings.eventInterceptors.map((binding) => `    Object.freeze({ id: ${binding.id}, interceptor: ${binding.local} }),`).join("\n")}
  ]),
}) satisfies EventRuntimeBindings;
`;
}
function eventsManifestSource(optimized: OptimizedApplication): string {
  const value = {
    policy: "stable-by-module-path-and-export-name",
    events: optimized.events.map((event) => ({
      id: event.id,
      symbol: optimized.strings[event.nameId],
      file: optimized.strings[event.fileId],
      line: event.line,
      column: event.column,
    })),
    listeners: optimized.eventListeners.map((listener) => ({
      id: listener.id,
      eventId: listener.eventId,
      symbol: optimized.strings[listener.nameId],
      file: optimized.strings[listener.fileId],
      line: listener.line,
      column: listener.column,
    })),
    interceptors: optimized.eventInterceptors.map((interceptor) => ({
      id: interceptor.id,
      symbol: optimized.strings[interceptor.nameId],
      file: optimized.strings[interceptor.fileId],
      line: interceptor.line,
      column: interceptor.column,
    })),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}
function controllersSource(bindings: ExecutableBindingPlan): string {
  const imports = renderImports(bindings.controllers.map((binding) => binding.symbol));
  const rows = bindings.controllers.map((binding) => `  Object.freeze({
    id: ${binding.id}, graphId: ${binding.graphId}, transport: ${JSON.stringify(binding.transport)},
    token: ${binding.symbol.local},
    providerIds: Object.freeze(${JSON.stringify(binding.providerIds)}),
    factory: (context: ProviderBindingContext) => context.run(() => new ${binding.symbol.local}()),
  }),`).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import type { ControllerBinding, ProviderBindingContext } from "@warbler/runtime";
${imports}
export const controllerBindings = Object.freeze([
${rows}
]) satisfies readonly ControllerBinding[];
`;
}
function handlersSource(bindings: ExecutableBindingPlan): string {
  const imports = renderImports(bindings.handlers.flatMap((binding) => binding.kind === "method" ? [binding.controller] : binding.expression.imports));
  const functions = bindings.handlers.map((binding) => binding.kind === "method" ? `const invokeHandler${binding.id} = (
  controller: InstanceType<typeof ${binding.controller.local}>,
  ...input: Parameters<InstanceType<typeof ${binding.controller.local}>[${JSON.stringify(binding.method)}]>
): ReturnType<InstanceType<typeof ${binding.controller.local}>[${JSON.stringify(binding.method)}]> =>
  controller.${binding.method}(...input);
` : `const invokeHandler${binding.id} = (
  _controller: undefined,
  ...input: Parameters<typeof ${binding.expression.text}.run>
): ReturnType<typeof ${binding.expression.text}.run> =>
  ${binding.expression.text}.run(...input);
`).join("\n");
  const rows = bindings.handlers.map((binding) => binding.kind === "method"
    ? `  Object.freeze({ kind: "method", id: ${binding.id}, controllerId: ${binding.controllerId}, parameterCount: ${binding.parameterCount}, invoke: invokeHandler${binding.id} }),`
    : `  Object.freeze({ kind: "function", id: ${binding.id}, graphId: ${binding.graphId}, parameterCount: ${binding.parameterCount}, useCaseKeys: Object.freeze(${JSON.stringify(binding.useCaseKeys)}), useCaseProviderIds: Object.freeze(${JSON.stringify(binding.useCaseProviderIds)}), invoke: invokeHandler${binding.id} }),`
  ).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import type { HandlerBinding } from "@warbler/runtime";
${imports}
${functions}
export const handlerBindings = Object.freeze([
${rows}
]) satisfies readonly HandlerBinding[];
`;
}
function executableValuesSource(table: string, property: string, bindings: readonly (BindingImport & { readonly id: number })[]): string {
  return `/* Generated by @warbler/compiler. Do not edit. */
${renderImports(bindings)}
export const ${table} = Object.freeze([
${bindings.map((binding) => `  Object.freeze({ id: ${binding.id}, ${property}: ${binding.local} }),`).join("\n")}
]);
`;
}
function validatorsSource(bindings: readonly (BindingImport & { readonly id: number })[]): string {
  const compiled = bindings.map((binding) => `const CompiledValidator${binding.id} = compileValidator(${binding.local}, ${binding.id});`).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import { compileValidator } from "@warbler/validators";
${renderImports(bindings)}
${compiled}
export const validatorBindings = Object.freeze([
${bindings.map((binding) => `  Object.freeze({ id: ${binding.id}, flags: CompiledValidator${binding.id}.flags, validate: CompiledValidator${binding.id}.execute, onValidationError: CompiledValidator${binding.id}.onValidationError }),`).join("\n")}
]);
`;
}
function httpBindingsSource(optimized: OptimizedApplication): string {
  const rows = optimized.routes.map((route) => `  Object.freeze(${JSON.stringify(route)}),`).join("\n");
  const hasValidators = optimized.routes.some((route) => route.validatorId >= 0);
  const requestRequirements = hasValidators
    ? `const httpRouteRequestRequirements = Object.freeze([
${optimized.routes.map((route) => `  ${route.validatorId < 0 ? "0" : `validatorBindings[${route.validatorId}]!.flags`},`).join("\n")}
]);
`
    : "";
  const paths = [...new Set(optimized.routes.map((route) => route.pathId))].sort((a, b) => a - b).map((pathId) => {
    const methods = optimized.routes.filter((route) => route.pathId === pathId).map((route) =>
      route.validatorId < 0
        ? `    [strings[${route.methodId}]!]: (request: Request) => executeHttpRoute(${route.id}, request),`
        : `    [strings[${route.methodId}]!]: (request: Request) => {
      const input = prepareHttpValidationInput(request, httpRouteRequestRequirements[${route.id}]!);
      return input instanceof Promise ? input.then((prepared) => executeHttpRoute(${route.id}, request, prepared)) : executeHttpRoute(${route.id}, request, input);
    },`,
    ).join("\n");
    return `  [strings[${pathId}]!]: Object.freeze({\n${methods}\n  }),`;
  }).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import type { HttpRouteExecutor } from "@warbler/runtime";
${hasValidators ? `import { prepareHttpValidationInput } from "@warbler/http";
import { validatorBindings } from "./validators.generated";` : ""}
import { strings } from "./tables.generated";
${requestRequirements}
export const httpRouteBindings = Object.freeze([
${rows}
]);
export const createHttpRoutes = (executeHttpRoute: HttpRouteExecutor) => Object.freeze({
${paths}
});
`;
}
function websocketBindingsSource(optimized: OptimizedApplication): string {
  const entries = optimized.socketEvents.map((event) =>
    `  [strings[${event.eventId}]!]: Object.freeze(${JSON.stringify(event)}),`,
  ).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import { strings } from "./tables.generated";
export const socketEventBindings = Object.freeze({
${entries}
});
export const unknownSocketEvent = undefined;
`;
}
function bindingsSource(bindings: ExecutableBindingPlan, optimized: OptimizedApplication): string {
  const imports = [
    `import { strings, graphIds, providerTable, providerDependencies, routeTable, socketEventTable, routeGuards, routeMiddleware, socketGuards, socketMiddleware } from "./tables.generated";`,
    bindings.providers.length > 0 ? `import { providerBindings } from "./providers.generated";` : "",
    bindings.controllers.length > 0 ? `import { controllerBindings } from "./controllers.generated";` : "",
    bindings.handlers.length > 0 ? `import { handlerBindings } from "./handlers.generated";` : "",
    bindings.guards.length > 0 ? `import { guardBindings } from "./guards.generated";` : "",
    bindings.middlewares.length > 0 ? `import { middlewareBindings } from "./middleware.generated";` : "",
    bindings.validators.length > 0 ? `import { validatorBindings } from "./validators.generated";` : "",
    optimized.routes.length > 0 ? `import { createHttpRoutes, httpRouteBindings } from "./http.generated";` : "",
    optimized.socketEvents.length > 0 ? `import { socketEventBindings } from "./websocket.generated";` : "",
  ].filter(Boolean).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
import type { GeneratedApplicationBindings } from "@warbler/runtime";
${imports}
export const applicationBindings = Object.freeze({
  application: Object.freeze({
    strings, graphIds, providerTable, providerDependencies, routeTable, socketEventTable,
    routeGuards, routeMiddleware, socketGuards, socketMiddleware,
  }),
  providers: ${bindings.providers.length > 0 ? "providerBindings" : "Object.freeze([])"},
  controllers: ${bindings.controllers.length > 0 ? "controllerBindings" : "Object.freeze([])"},
  handlers: ${bindings.handlers.length > 0 ? "handlerBindings" : "Object.freeze([])"},
  guards: ${bindings.guards.length > 0 ? "guardBindings" : "Object.freeze([])"},
  middleware: ${bindings.middlewares.length > 0 ? "middlewareBindings" : "Object.freeze([])"},
  validators: ${bindings.validators.length > 0 ? "validatorBindings" : "Object.freeze([])"},
  ${optimized.routes.length > 0 ? "http: Object.freeze({ routes: httpRouteBindings, createRoutes: createHttpRoutes })," : ""}
  ${optimized.socketEvents.length > 0 ? "websocket: Object.freeze({ events: socketEventBindings })," : ""}
}) satisfies GeneratedApplicationBindings;
export default applicationBindings;
`;
}
function productionSource(): string {
  return `/* Generated by @warbler/compiler. Do not edit. */
import { createExecutableBindingsRuntime, type ExecutableBindingsRuntime, type GeneratedApplicationBindings } from "@warbler/runtime";
import applicationBindings from "./application.generated";
export type GeneratedRuntimeLauncher<T = ExecutableBindingsRuntime> = (bindings: GeneratedApplicationBindings) => T | Promise<T>;
export const startGeneratedApplication = <T = ExecutableBindingsRuntime>(
  launcher: GeneratedRuntimeLauncher<T> = createExecutableBindingsRuntime as GeneratedRuntimeLauncher<T>,
): T | Promise<T> => launcher(applicationBindings);
const runtime = startGeneratedApplication();
export default runtime;
`;
}
/**
 * Emits a pure type-level `declare module "@warbler/http"` augmentation merging every
 * resolved `context.set(key, value)` call site into `WarblerRequestContext`. All keys
 * are optional: the compiler can't statically prove every request path sets every key.
 */
function contextTypesSource(entries: readonly ContextEntryBindingPlan[]): string {
  const imports = renderTypeImports(entries.flatMap((entry) => entry.imports));
  const members = entries.map((entry) => `    readonly ${propertyKey(entry.key)}?: ${entry.typeText};`).join("\n");
  return `/* Generated by @warbler/compiler. Do not edit. */
${imports}
export {};
declare module "@warbler/http" {
  interface WarblerRequestContext {
${members}
  }
}
`;
}
function propertyKey(key: string): string { return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : JSON.stringify(key); }
function renderTypeImports(values: readonly BindingImport[]): string {
  const unique = [...new Map(values.map((value) => [`${value.module}:${value.imported}`, value])).values()]
    .sort((left, right) => compareText(left.module, right.module) || compareText(left.imported, right.imported));
  return unique.map((value) => value.kind === "namespace"
    ? `import type * as ${value.local} from ${JSON.stringify(value.module)};`
    : value.kind === "default"
    ? `import type ${value.local} from ${JSON.stringify(value.module)};`
    : value.local === value.imported
      ? `import type { ${value.imported} } from ${JSON.stringify(value.module)};`
      : `import type { ${value.imported} as ${value.local} } from ${JSON.stringify(value.module)};`
  ).join("\n");
}
function renderImports(values: readonly BindingImport[]): string {
  const unique = [...new Map(values.map((value) => [`${value.module}:${value.imported}`, value])).values()]
    .sort((left, right) => compareText(left.module, right.module) || compareText(left.imported, right.imported));
  return unique.map((value) => value.kind === "namespace"
    ? `import * as ${value.local} from ${JSON.stringify(value.module)};`
    : value.kind === "default"
    ? `import ${value.local} from ${JSON.stringify(value.module)};`
    : `import { ${value.imported} as ${value.local} } from ${JSON.stringify(value.module)};`
  ).join("\n");
}
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
