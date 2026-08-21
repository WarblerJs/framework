import ts from "typescript";
import type { CompilerContext } from "../project/compiler-context";
import type {
  CapturedExpressionWIR,
  ControllerWIR,
  EventDispatchEdgeWIR,
  EventInterceptorWIR,
  EventListenerWIR,
  EventWIR,
  ProviderWIR,
  RouteWIR,
  SocketEventWIR,
  SourceLocationWIR,
  HandlerUseCaseWIR,
} from "../wir/wir";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostic";

const CLASS_DECORATORS = new Set(["Graph", "Controller", "SocketController", "Service", "Repository", "Factory", "Resolver", "Gateway", "Injectable"]);
const ROUTE_DECORATORS = new Map([
  ["Get", "GET"], ["Post", "POST"], ["Put", "PUT"], ["Patch", "PATCH"], ["Delete", "DELETE"],
  ["Options", "OPTIONS"], ["Head", "HEAD"], ["Sse", "GET"],
]);
const SOCKET_LIFECYCLES = new Map([
  ["OnOpen", "open"], ["OnMessage", "message"], ["OnClose", "close"], ["OnDrain", "drain"], ["OnError", "error"],
]);
const DECLARATIVE_SOCKET_LIFECYCLES = new Map([["OPEN", "open"], ["DRAIN", "drain"], ["CLOSE", "close"]]);
const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const SOCKET_LIFECYCLE_NAMES = new Set(["open", "message", "close", "drain", "error"]);
const PROVIDERS: ReadonlyMap<string, ProviderWIR["kind"]> = new Map([
  ["Service", "service"], ["Repository", "repository"], ["Factory", "factory"],
  ["Resolver", "resolver"], ["Gateway", "gateway"], ["Injectable", "injectable"],
]);

/** Graph declaration before ownership validation. */
export interface AnalyzedGraph extends SourceLocationWIR {
  readonly name: string; readonly prefix: string; readonly transport: string;
  readonly middleware: readonly string[];
  readonly controllerNames: readonly string[]; readonly providerNames: readonly string[];
}
/** Complete single-pass analysis output. */
export interface AnalysisResult {
  readonly transports: readonly string[];
  readonly middleware: readonly string[];
  readonly graphs: readonly AnalyzedGraph[];
  readonly controllers: ReadonlyMap<string, ControllerWIR>;
  readonly providers: ReadonlyMap<string, ProviderWIR>;
  readonly frameworkProviders: readonly FrameworkProviderReference[];
  readonly events: ReadonlyMap<string, EventWIR>;
  readonly eventListeners: ReadonlyMap<string, EventListenerWIR>;
  readonly eventInterceptors: ReadonlyMap<string, EventInterceptorWIR>;
}
interface HandlerOptions {
  readonly validator?: string;
  readonly middleware: readonly string[];
  readonly guards: readonly string[];
  readonly useCases: readonly HandlerUseCaseWIR[];
}
const EMPTY_HANDLER_OPTIONS: HandlerOptions = Object.freeze({
  middleware: Object.freeze([]),
  guards: Object.freeze([]),
  useCases: Object.freeze([]),
});
/** Framework-owned provider imported by application code and registered by generated bindings. */
export interface FrameworkProviderReference extends SourceLocationWIR {
  readonly module: "@warbler/email" | "@warbler/events" | "@warbler/websocket";
  readonly imported: "Email" | "EventDispatcher" | "SocketPublisher";
  readonly local: string;
}

/** Traverses every application SourceFile once and records all Phase 1 declarations. */
export function analyzeProgram(context: CompilerContext): AnalysisResult {
  const graphs: AnalyzedGraph[] = [];
  const transports: string[] = [];
  const middleware: string[] = [];
  const controllers = new Map<string, ControllerWIR>();
  const providers = new Map<string, ProviderWIR>();
  const frameworkProviders = new Map<string, FrameworkProviderReference>();
  const events = new Map<string, EventWIR>();
  const eventListeners = new Map<string, EventListenerWIR>();
  const eventInterceptors = new Map<string, EventInterceptorWIR>();
  const sourceAliases = new Map<ts.SourceFile, ReadonlyMap<string, string>>();
  const handlerOptions = new Map<string, HandlerOptions>();
  const csrfValidators = new Set<string>();

  for (const sourceFile of context.sourceFiles) {
    const aliases = collectAliases(sourceFile);
    sourceAliases.set(sourceFile, aliases);
    collectHandlerDefinitions(sourceFile, aliases, handlerOptions, context.diagnostics);
    collectValidatorDefinitions(sourceFile, aliases, csrfValidators);
  }

  for (const sourceFile of context.sourceFiles) {
    const aliases = sourceAliases.get(sourceFile) ?? collectAliases(sourceFile);
    transports.push(...collectApplicationTransports(sourceFile, aliases));
    middleware.push(...collectApplicationMiddleware(sourceFile, aliases, context.diagnostics));
    for (const reference of collectFrameworkProviders(sourceFile)) frameworkProviders.set(reference.local, reference);
    collectEventDeclarations(sourceFile, aliases, context.typeChecker, events, eventListeners, eventInterceptors, context.diagnostics);
    analyzeDeclarativeGraphs(sourceFile, aliases, graphs, controllers, providers, handlerOptions, csrfValidators, context.diagnostics);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name !== undefined) {
        analyzeClass(node, sourceFile, aliases, graphs, controllers, providers, context.diagnostics);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return Object.freeze({
    transports: Object.freeze(unique(transports)),
    middleware: Object.freeze(middleware),
    graphs: Object.freeze(graphs),
    controllers,
    providers,
    frameworkProviders: Object.freeze([...frameworkProviders.values()]),
    events,
    eventListeners,
    eventInterceptors,
  });
}

function collectHandlerDefinitions(
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
  output: Map<string, HandlerOptions>,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !ts.isCallExpression(declaration.initializer)) continue;
      if (callName(declaration.initializer.expression, aliases) !== "defineHandler") continue;
      const object = objectArgument(declaration.initializer, 0);
      if (object === undefined) continue;
      rejectSingularMiddleware(object, declaration, source, diagnostics);
      output.set(declaration.name.text, Object.freeze({
        ...(objectReference(object, "validator") === undefined ? {} : { validator: objectReference(object, "validator")! }),
        middleware: Object.freeze(objectReferenceArray(object, "middlewares")),
        guards: Object.freeze(objectReferenceArray(object, "guards")),
        useCases: Object.freeze(objectReferenceMap(object, "useCase")),
      }));
    }
  }
}

function collectValidatorDefinitions(source: ts.SourceFile, aliases: ReadonlyMap<string, string>, output: Set<string>): void {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !ts.isCallExpression(declaration.initializer)) continue;
      if (callName(declaration.initializer.expression, aliases) !== "defineValidator") continue;
      if (objectBoolean(objectArgument(declaration.initializer, 0), "csrf")) output.add(declaration.name.text);
    }
  }
}

function analyzeDeclarativeGraphs(
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
  graphs: AnalyzedGraph[],
  controllers: Map<string, ControllerWIR>,
  providers: Map<string, ProviderWIR>,
  handlerOptions: ReadonlyMap<string, HandlerOptions>,
  csrfValidators: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !ts.isCallExpression(declaration.initializer)) continue;
        analyzeDeclarativeGraphCall(declaration.name.text, declaration.initializer, declaration, source, aliases, graphs, controllers, providers, handlerOptions, csrfValidators, diagnostics);
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && ts.isCallExpression(statement.expression)) {
      analyzeDeclarativeGraphCall(defaultGraphName(source), statement.expression, statement, source, aliases, graphs, controllers, providers, handlerOptions, csrfValidators, diagnostics);
    }
  }
}

function analyzeDeclarativeGraphCall(
  graphName: string,
  call: ts.CallExpression,
  node: ts.Node,
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
  graphs: AnalyzedGraph[],
  controllers: Map<string, ControllerWIR>,
  providers: Map<string, ProviderWIR>,
  handlerOptions: ReadonlyMap<string, HandlerOptions>,
  csrfValidators: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const callee = callName(call.expression, aliases);
  if (callee !== "defineHttpGraph" && callee !== "defineWebSocketGraph") return;
  const object = objectArgument(call, 0);
  if (object === undefined) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `${callee}("${graphName}") requires an object literal.`, call, source, [graphName]);
    return;
  }
  rejectSingularMiddleware(object, node, source, diagnostics);
  const transport = callee === "defineHttpGraph" ? "http" : "websocket";
  const controllerName = `${graphName}${transport === "http" ? "$http" : "$websocket"}`;
  const routes = transport === "http" ? declarativeHttpRoutes(object, source, handlerOptions, csrfValidators, diagnostics) : [];
  const socketEvents = transport === "websocket" ? declarativeSocketEvents(object, source, handlerOptions, diagnostics) : [];
  graphs.push(Object.freeze({
    ...location(node, source),
    name: graphName,
    prefix: objectString(object, "prefix", ""),
    transport,
    middleware: Object.freeze(objectReferenceArray(object, "middlewares")),
    controllerNames: Object.freeze([controllerName]),
    providerNames: Object.freeze(unique([
      ...providerElementNames(object, graphName, aliases, providers, source, diagnostics),
      ...routes.flatMap((route) => route.useCases.map((item) => item.provider)),
      ...socketEvents.flatMap((event) => event.useCases.map((item) => item.provider)),
    ])),
  }));
  const controller: ControllerWIR = Object.freeze({
    ...location(node, source),
    name: controllerName,
    kind: transport,
    synthetic: true,
    prefix: "",
    middleware: Object.freeze([]),
    providerNames: Object.freeze([]),
    providers: Object.freeze([]),
    dependencies: Object.freeze([]),
    routes: Object.freeze(routes),
    socketEvents: Object.freeze(socketEvents),
  });
  if (controllers.has(controllerName)) diagnostic(diagnostics, DiagnosticCode.DUPLICATE_CONTROLLER, `Duplicate generated controller "${controllerName}".`, node, source, [controllerName]);
  else controllers.set(controllerName, controller);
}

function declarativeHttpRoutes(
  object: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
  handlerOptions: ReadonlyMap<string, HandlerOptions>,
  csrfValidators: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): readonly RouteWIR[] {
  const routesObject = objectChildObject(object, "routes");
  if (routesObject === undefined) return Object.freeze([]);
  const routes: RouteWIR[] = [];
  for (const property of routesObject.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name) ?? "";
    const parsed = parseRouteKey(key);
    if (parsed === undefined) {
      diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Invalid HTTP route key "${key}". Use METHOD /path with a supported uppercase method.`, property, source, [key]);
      continue;
    }
    const options = ts.isObjectLiteralExpression(property.initializer) && findProperty(property.initializer, "handler") !== undefined ? property.initializer : undefined;
    if (options !== undefined) {
      rejectSingularMiddleware(options, property, source, diagnostics);
      rejectForbiddenDeclarativeOptions(options, ["validator", "guards", "useCase", "providers"], property, source, diagnostics);
    }
    const handler = options === undefined ? expressionReference(property.initializer) : objectReference(options, "handler");
    if (handler === undefined) {
      diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `HTTP route "${key}" is missing a handler.`, property, source, [key]);
      continue;
    }
    const inherited = handlerOptionsFor(handlerOptions, handler);
    const validator = inherited.validator;
    routes.push(Object.freeze({
      ...location(property, source),
      method: parsed.method,
      path: parsed.path,
      handler,
      ...(validator === undefined ? {} : { validator }),
      ...(options === undefined ? {} : objectStringOrUndefined(options, "name") === undefined ? {} : { name: objectStringOrUndefined(options, "name")! }),
      middleware: Object.freeze(options === undefined ? inherited.middleware : [...objectReferenceArray(options, "middlewares"), ...inherited.middleware]),
      guards: inherited.guards,
      useCases: inherited.useCases,
      csrf: validator === undefined ? false : csrfValidators.has(lastReferenceSegment(validator)),
      viewContext: false,
    }));
  }
  return Object.freeze(routes);
}

function declarativeSocketEvents(
  object: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
  handlerOptions: ReadonlyMap<string, HandlerOptions>,
  diagnostics: CompilerDiagnostic[],
): readonly SocketEventWIR[] {
  const eventsObject = objectChildObject(object, "events");
  if (eventsObject === undefined) return Object.freeze([]);
  const events: SocketEventWIR[] = [];
  for (const property of eventsObject.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name) ?? "";
    const parsed = parseSocketEventKey(key);
    if (parsed === undefined) {
      diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Invalid WebSocket event key "${key}". Use OPEN, DRAIN, CLOSE, MSG name, or SUB name.`, property, source, [key]);
      continue;
    }
    const options = ts.isObjectLiteralExpression(property.initializer) && findProperty(property.initializer, "handler") !== undefined ? property.initializer : undefined;
    if (options !== undefined) {
      rejectSingularMiddleware(options, property, source, diagnostics);
      rejectForbiddenDeclarativeOptions(options, ["validator", "guards", "useCase", "providers"], property, source, diagnostics);
    }
    const handler = options === undefined ? expressionReference(property.initializer) : objectReference(options, "handler");
    if (handler === undefined) {
      diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `WebSocket event "${key}" is missing a handler.`, property, source, [key]);
      continue;
    }
    const inherited = handlerOptionsFor(handlerOptions, handler);
    events.push(Object.freeze({
      ...location(property, source),
      kind: parsed.kind,
      event: parsed.event,
      handler,
      ...(inherited.validator === undefined ? {} : { validator: inherited.validator }),
      middleware: Object.freeze(options === undefined ? inherited.middleware : [...objectReferenceArray(options, "middlewares"), ...inherited.middleware]),
      guards: inherited.guards,
      useCases: inherited.useCases,
      compression: false,
      binary: false,
      authentication: false,
      rateLimit: false,
    }));
  }
  return Object.freeze(events);
}

function analyzeClass(
  node: ts.ClassDeclaration,
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
  graphs: AnalyzedGraph[],
  controllers: Map<string, ControllerWIR>,
  providers: Map<string, ProviderWIR>,
  diagnostics: CompilerDiagnostic[],
): void {
  const name = node.name!.text;
  const decorators = getDecorators(node).map((item) => decoratorInfo(item, aliases));
  const classDecorators = decorators.filter((item) => CLASS_DECORATORS.has(item.name));
  if (classDecorators.length > 1) diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Class "${name}" has multiple Warbler class decorators.`, node, source, classDecorators.map((item) => item.name));
  const graphDecorator = classDecorators.find((item) => item.name === "Graph");
  if (graphDecorator !== undefined) graphs.push(analyzeGraph(name, graphDecorator.call, node, source, aliases, providers, diagnostics));

  const controllerDecorator = classDecorators.find((item) => item.name === "Controller" || item.name === "SocketController");
  const routes: RouteWIR[] = [];
  const socketEvents: SocketEventWIR[] = [];
  const dependencies = new Set<string>();
  for (const member of node.members) {
    collectInjectDependencies(member, aliases, dependencies);
    const memberName = propertyName(member.name);
    for (const decorator of getDecorators(member).map((item) => decoratorInfo(item, aliases))) {
      const routeMethod = ROUTE_DECORATORS.get(decorator.name);
      if (routeMethod !== undefined) {
        if (controllerDecorator?.name !== "Controller" || memberName === undefined || !ts.isMethodDeclaration(member)) {
          diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `@${decorator.name} must decorate an HTTP controller method.`, member, source, [name]);
          continue;
        }
        const options = objectArgument(decorator.call, 1);
        const validator = objectReference(options, "validator");
        const routeName = objectStringOrUndefined(options, "name");
        const stream = decorator.name === "Sse" ? "sse" : objectEnum(options, "stream", ["sse", "html"]);
        const response = objectEnum(options, "response", ["static", "view", "json", "html"]);
        routes.push(Object.freeze({
          ...location(member, source), method: routeMethod, path: stringArgument(decorator.call, 0, ""), handler: memberName,
          ...(validator === undefined ? {} : { validator }),
          ...(routeName === undefined ? {} : { name: routeName }),
          middleware: Object.freeze(objectReferenceArray(options, "middleware")),
          guards: Object.freeze(objectReferenceArray(options, "guards")),
          useCases: Object.freeze([]),
          csrf: objectBoolean(options, "csrf"),
          viewContext: usesHttpViewContext(member, aliases),
          ...(stream === undefined ? {} : { stream }),
          ...(response === undefined ? {} : { response }),
        }));
      }
      if (decorator.name === "Subscribe" || SOCKET_LIFECYCLES.has(decorator.name)) {
        if (controllerDecorator?.name !== "SocketController" || memberName === undefined || !ts.isMethodDeclaration(member)) {
          diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `@${decorator.name} must decorate a socket controller method.`, member, source, [name]);
          continue;
        }
        const lifecycle = SOCKET_LIFECYCLES.get(decorator.name);
        const options = objectArgument(decorator.call, 1);
        const validator = objectReference(options, "validator");
        socketEvents.push(Object.freeze({
          ...location(member, source),
          kind: lifecycle === undefined ? "event" : "lifecycle",
          event: lifecycle ?? stringArgument(decorator.call, 0, ""),
          handler: memberName,
          ...(validator === undefined ? {} : { validator }),
          middleware: Object.freeze(objectReferenceArray(options, "middleware")),
          guards: Object.freeze(objectReferenceArray(options, "guards")),
          useCases: Object.freeze([]),
          compression: objectBoolean(options, "compression"),
          binary: objectBoolean(options, "binary"),
          authentication: objectBoolean(options, "authentication"),
          rateLimit: options !== undefined && findProperty(options, "rateLimit") !== undefined,
        }));
      }
    }
  }

  if (controllerDecorator !== undefined) {
    const kind = controllerDecorator.name === "Controller" ? "http" : "websocket";
    const controllerOptions = kind === "http" ? controllerObject(controllerDecorator.call) : undefined;
    const result: ControllerWIR = Object.freeze({
      ...location(node, source), name, kind,
      prefix: kind === "http" ? controllerPrefix(controllerDecorator.call) : "",
      middleware: Object.freeze(kind === "http" ? objectReferenceArray(controllerOptions, "middleware") : []),
      providerNames: Object.freeze(kind === "http" ? controllerProviderElementNames(controllerOptions, name, aliases, providers, source, diagnostics) : []),
      providers: Object.freeze([]),
      dependencies: Object.freeze([...dependencies]),
      routes: Object.freeze(routes), socketEvents: Object.freeze(socketEvents),
    });
    if (controllers.has(name)) diagnostic(diagnostics, kind === "http" ? DiagnosticCode.DUPLICATE_CONTROLLER : DiagnosticCode.DUPLICATE_SOCKET_CONTROLLER, `Duplicate ${kind} controller "${name}".`, node, source, [name]);
    else controllers.set(name, result);
  } else if (routes.length > 0 || socketEvents.length > 0) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Class "${name}" uses handler decorators without a controller decorator.`, node, source, [name]);
  }

  const providerDecorator = classDecorators.find((item) => PROVIDERS.has(item.name));
  if (providerDecorator !== undefined) {
    const kind = PROVIDERS.get(providerDecorator.name)!;
    const resolved = resolveProvide(providerDecorator.call, aliases);
    if (resolved === undefined) diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider "${name}" has an invalid provide scope.`, node, source, [name]);
    const result: ProviderWIR = Object.freeze({
      ...location(node, source), name, kind, provide: resolved?.provide ?? "graph",
      ...(resolved?.token === undefined ? {} : { token: resolved.token }),
      registration: "class", implementation: name,
      dependencies: Object.freeze([...dependencies]),
    });
    if (providers.has(name)) diagnostic(diagnostics, DiagnosticCode.DUPLICATE_PROVIDER, `Duplicate provider "${name}".`, node, source, [name]);
    else providers.set(name, result);
  }
}

function analyzeGraph(
  name: string,
  call: ts.CallExpression | undefined,
  node: ts.Node,
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
  providers: Map<string, ProviderWIR>,
  diagnostics: CompilerDiagnostic[],
): AnalyzedGraph {
  const options = call?.arguments[0];
  if (options !== undefined && !ts.isObjectLiteralExpression(options)) diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `@Graph options for "${name}" must be an object literal.`, options, source, [name]);
  const object = options !== undefined && ts.isObjectLiteralExpression(options) ? options : undefined;
  return Object.freeze({
    ...location(node, source), name,
    prefix: objectString(object, "prefix", ""),
    transport: objectTransport(object),
    middleware: Object.freeze(objectReferenceArray(object, "middleware")),
    controllerNames: Object.freeze(objectNames(object, "controllers")),
    providerNames: Object.freeze(providerElementNames(object, name, aliases, providers, source, diagnostics)),
  });
}

/** Parses a Graph's `providers: [...]` array, recognizing both bare class references and `Provider({...})` object-literal registrations. */
function providerElementNames(
  object: ts.ObjectLiteralExpression | undefined,
  graphName: string,
  aliases: ReadonlyMap<string, string>,
  providers: Map<string, ProviderWIR>,
  source: ts.SourceFile,
  diagnostics: CompilerDiagnostic[],
): string[] {
  const property = object === undefined ? undefined : findProperty(object, "providers");
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.map((element, index) => {
    if (ts.isCallExpression(element) && ts.isIdentifier(element.expression) && (aliases.get(element.expression.text) ?? element.expression.text) === "Provider") {
      const syntheticName = `${graphName}#Provider${index}`;
      const registration = analyzeProviderRegistration(syntheticName, element, graphName, "graph", aliases, source, diagnostics);
      if (registration !== undefined) providers.set(syntheticName, registration);
      return syntheticName;
    }
    return referenceName(element);
  });
}

/** Parses a Controller's local `providers: [...]` array. */
function controllerProviderElementNames(
  object: ts.ObjectLiteralExpression | undefined,
  controllerName: string,
  aliases: ReadonlyMap<string, string>,
  providers: Map<string, ProviderWIR>,
  source: ts.SourceFile,
  diagnostics: CompilerDiagnostic[],
): string[] {
  const property = object === undefined ? undefined : findProperty(object, "providers");
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.map((element, index) => {
    if (ts.isCallExpression(element) && ts.isIdentifier(element.expression) && (aliases.get(element.expression.text) ?? element.expression.text) === "Provider") {
      const syntheticName = `${controllerName}#Provider${index}`;
      const registration = analyzeProviderRegistration(syntheticName, element, controllerName, "controller", aliases, source, diagnostics);
      if (registration !== undefined) providers.set(syntheticName, registration);
      return syntheticName;
    }
    return referenceName(element);
  });
}

/** Parses one `Provider({...})` call into a synthetic ProviderWIR entry. */
function analyzeProviderRegistration(
  syntheticName: string,
  call: ts.CallExpression,
  ownerName: string,
  provide: "graph" | "controller",
  aliases: ReadonlyMap<string, string>,
  source: ts.SourceFile,
  diagnostics: CompilerDiagnostic[],
): ProviderWIR | undefined {
  const object = call.arguments[0];
  if (object === undefined || !ts.isObjectLiteralExpression(object)) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider(...) in "${ownerName}" requires an object literal argument.`, call, source, [ownerName]);
    return undefined;
  }
  const provideProperty = findProperty(object, "provide");
  if (provideProperty === undefined || !ts.isPropertyAssignment(provideProperty)) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider(...) in "${ownerName}" is missing a "provide" token.`, call, source, [ownerName]);
    return undefined;
  }
  const token = referenceName(provideProperty.initializer);
  const base = { ...location(call, source), name: syntheticName, kind: "registration" as const, provide, token };

  const useClass = findProperty(object, "useClass");
  if (useClass !== undefined && ts.isPropertyAssignment(useClass)) {
    return Object.freeze({ ...base, registration: "class", implementation: referenceName(useClass.initializer), dependencies: Object.freeze([]) });
  }
  const useValue = findProperty(object, "useValue");
  if (useValue !== undefined && ts.isPropertyAssignment(useValue)) {
    return Object.freeze({ ...base, registration: "useValue", capturedValue: captureExpression(useValue.initializer, aliases, source), dependencies: Object.freeze([]) });
  }
  const useFactory = findProperty(object, "useFactory");
  const factoryNode = useFactory === undefined ? undefined : ts.isMethodDeclaration(useFactory) ? useFactory : ts.isPropertyAssignment(useFactory) ? useFactory.initializer : undefined;
  if (factoryNode !== undefined) {
    const dependencies = new Set<string>();
    collectInjectDependencies(factoryNode, aliases, dependencies);
    return Object.freeze({ ...base, registration: "useFactory", capturedFactory: captureExpression(factoryNode, aliases, source), dependencies: Object.freeze([...dependencies]) });
  }
  const useExisting = findProperty(object, "useExisting");
  if (useExisting !== undefined && ts.isPropertyAssignment(useExisting)) {
    const existing = referenceName(useExisting.initializer);
    return Object.freeze({ ...base, registration: "useExisting", existing, dependencies: Object.freeze([existing]) });
  }
  diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider(...) in "${ownerName}" must declare useClass, useValue, useFactory, or useExisting.`, call, source, [ownerName]);
  return undefined;
}

function collectApplicationTransports(source: ts.SourceFile, aliases: ReadonlyMap<string, string>): readonly string[] {
  const transports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callName(node.expression, aliases) === "createApp") {
      const property = findPropertySafe(objectArgument(node, 0), "transports");
      if (property !== undefined && ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer)) {
        for (const element of property.initializer.elements) {
          const transport = transportName(element);
          if (transport !== undefined) transports.push(transport);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return transports;
}

function collectApplicationMiddleware(source: ts.SourceFile, aliases: ReadonlyMap<string, string>, diagnostics: CompilerDiagnostic[]): readonly string[] {
  const middleware: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callName(node.expression, aliases) === "createApp") {
      const object = objectArgument(node, 0);
      if (object !== undefined) {
        if (findProperty(object, "middleware") !== undefined || findProperty(object, "middlewares") !== undefined) {
          diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `createApp() does not accept application-level middleware. Move middlewares to graphs or handlers.`, node, source, ["createApp"]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return middleware;
}

/** Captures an expression's verbatim source text plus the free identifiers it references, skipping bound parameter/variable names and property keys. */
function captureExpression(node: ts.Node, aliases: ReadonlyMap<string, string>, source: ts.SourceFile): CapturedExpressionWIR {
  const bound = new Set<string>();
  const captures = new Set<string>();
  const bindName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) { bound.add(name.text); return; }
    for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindName(element.name);
  };
  const visit = (child: ts.Node): void => {
    if (ts.isPropertyAccessExpression(child)) { visit(child.expression); return; }
    if (ts.isPropertyAssignment(child)) { visit(child.initializer); return; }
    if (ts.isMethodDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child) || ts.isFunctionDeclaration(child)) {
      for (const parameter of child.parameters) { bindName(parameter.name); if (parameter.initializer !== undefined) visit(parameter.initializer); }
      if (child.body !== undefined) visit(child.body);
      return;
    }
    if (ts.isVariableDeclaration(child)) { bindName(child.name); if (child.initializer !== undefined) visit(child.initializer); return; }
    if (ts.isIdentifier(child)) {
      if (!bound.has(child.text)) captures.add(aliases.get(child.text) ?? child.text);
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return Object.freeze({ text: node.getText(source), captures: Object.freeze([...captures]) });
}

interface DecoratorInfo { readonly name: string; readonly call?: ts.CallExpression }
function decoratorInfo(decorator: ts.Decorator, aliases: ReadonlyMap<string, string>): DecoratorInfo {
  const expression = decorator.expression;
  const call = ts.isCallExpression(expression) ? expression : undefined;
  const target = call?.expression ?? expression;
  let name = "";
  if (ts.isIdentifier(target)) name = aliases.get(target.text) ?? target.text;
  else if (ts.isPropertyAccessExpression(target)) name = target.name.text;
  return call === undefined ? { name } : { name, call };
}
function callName(expression: ts.Expression, aliases: ReadonlyMap<string, string>): string {
  if (ts.isIdentifier(expression)) return aliases.get(expression.text) ?? expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}
function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}
function collectAliases(source: ts.SourceFile): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.namedBindings === undefined) continue;
    const bindings = statement.importClause.namedBindings;
    if (ts.isNamedImports(bindings)) for (const element of bindings.elements) result.set(element.name.text, element.propertyName?.text ?? element.name.text);
  }
  return result;
}
function collectFrameworkProviders(source: ts.SourceFile): readonly FrameworkProviderReference[] {
  const result: FrameworkProviderReference[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (module !== "@warbler/email" && module !== "@warbler/events" && module !== "@warbler/websocket") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (module === "@warbler/websocket" && imported === "SocketPublisher") {
        result.push(Object.freeze({ ...location(element, source), module, imported, local: element.name.text }));
      }
      if (module === "@warbler/events" && imported === "EventDispatcher") {
        result.push(Object.freeze({ ...location(element, source), module, imported, local: element.name.text }));
      }
      if (module === "@warbler/email" && imported === "Email") {
        result.push(Object.freeze({ ...location(element, source), module, imported, local: element.name.text }));
      }
    }
  }
  return Object.freeze(result);
}
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}
function collectEventDeclarations(
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
  checker: ts.TypeChecker,
  events: Map<string, EventWIR>,
  listeners: Map<string, EventListenerWIR>,
  interceptors: Map<string, EventInterceptorWIR>,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !ts.isCallExpression(declaration.initializer)) continue;
      const name = declaration.name.text;
      const call = declaration.initializer;
      const callee = ts.isIdentifier(call.expression) ? aliases.get(call.expression.text) ?? call.expression.text : "";
      const key = eventDeclarationKey(source.fileName, name);
      if (callee === "event") {
        events.set(key, Object.freeze({ ...location(declaration, source), key, name }));
        continue;
      }
      if (callee === "listen") {
        const eventArgument = call.arguments[0];
        if (eventArgument === undefined || !ts.isIdentifier(eventArgument)) {
          diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Event listener "${name}" must reference a static event symbol.`, declaration, source, [name]);
          continue;
        }
        const callback = call.arguments[1];
        listeners.set(key, Object.freeze({
          ...location(declaration, source),
          name,
          event: eventReferenceKey(eventArgument, source, checker),
          dispatches: Object.freeze(callback === undefined ? [] : collectEventDispatchEdges(callback, aliases, source, checker)),
        }));
        continue;
      }
      if (callee === "interceptEvent") {
        interceptors.set(key, Object.freeze({ ...location(declaration, source), name }));
      }
    }
  }
}
function collectEventDispatchEdges(node: ts.Node, aliases: ReadonlyMap<string, string>, source: ts.SourceFile, checker: ts.TypeChecker): readonly EventDispatchEdgeWIR[] {
  const edges: EventDispatchEdgeWIR[] = [];
  const visit = (child: ts.Node, conditional: boolean): void => {
    if (ts.isCallExpression(child) && isDispatchCall(child.expression)) {
      const first = child.arguments[0];
      if (first !== undefined && ts.isCallExpression(first) && ts.isIdentifier(first.expression)) {
        edges.push(Object.freeze({ ...location(child, source), event: eventReferenceKey(first.expression, source, checker), unconditional: !conditional }));
      }
    }
    const nextConditional = conditional || ts.isIfStatement(child) || ts.isConditionalExpression(child) || ts.isSwitchStatement(child);
    ts.forEachChild(child, (item) => visit(item, nextConditional));
  };
  visit(node, false);
  return Object.freeze(edges);
}
function eventReferenceKey(identifier: ts.Identifier, source: ts.SourceFile, checker: ts.TypeChecker): string {
  const symbol = checker.getSymbolAtLocation(identifier);
  const resolved = symbol === undefined ? undefined : (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
  const declaration = resolved?.getDeclarations()?.find((item) => ts.isVariableDeclaration(item) && ts.isIdentifier(item.name));
  if (declaration !== undefined && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    return eventDeclarationKey(declaration.getSourceFile().fileName, declaration.name.text);
  }
  return eventDeclarationKey(source.fileName, identifier.text);
}
function eventDeclarationKey(file: string, name: string): string {
  return `${file.replaceAll("\\", "/")}#${name}`;
}
function isDispatchCall(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression) &&
    (expression.name.text === "dispatch" || expression.name.text === "dispatchAndWait");
}
function collectInjectDependencies(node: ts.Node, aliases: ReadonlyMap<string, string>, output: Set<string>): void {
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && (aliases.get(child.expression.text) ?? child.expression.text) === "inject") {
      const argument = child.arguments[0];
      if (argument !== undefined) output.add(referenceName(argument));
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}
function usesHttpViewContext(node: ts.Node, aliases: ReadonlyMap<string, string>): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(child)) {
      const expression = child.expression;
      if (ts.isIdentifier(expression)) {
        const name = aliases.get(expression.text) ?? expression.text;
        if (name === "view" || name === "csrf") found = true;
      } else if (ts.isPropertyAccessExpression(expression) && (expression.name.text === "view" || expression.name.text === "csrf")) {
        found = true;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}
/** Resolves a decorator's `provide:` option into a visibility scope and, when it references anything else, a token alias. */
function resolveProvide(call: ts.CallExpression | undefined, aliases: ReadonlyMap<string, string>): { readonly provide: "graph" | "root" | "request"; readonly token?: string } | undefined {
  const options = call?.arguments[0];
  if (options === undefined) return { provide: "graph" };
  if (!ts.isObjectLiteralExpression(options)) return undefined;
  const property = findProperty(options, "provide");
  if (property === undefined) return { provide: "graph" };
  if (!ts.isPropertyAssignment(property)) return undefined;
  const initializer = property.initializer;
  if (ts.isStringLiteral(initializer) && (initializer.text === "graph" || initializer.text === "root" || initializer.text === "request")) return { provide: initializer.text };
  if (
    ts.isPropertyAccessExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    (aliases.get(initializer.expression.text) ?? initializer.expression.text) === "ProviderScope"
  ) {
    if (initializer.name.text === "GRAPH") return { provide: "graph" };
    if (initializer.name.text === "ROOT") return { provide: "root" };
    if (initializer.name.text === "REQUEST") return { provide: "request" };
  }
  return { provide: "graph", token: referenceName(initializer) };
}
function objectString(object: ts.ObjectLiteralExpression | undefined, key: string, fallback: string): string {
  const property = object === undefined ? undefined : findProperty(object, key);
  return property !== undefined && ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : fallback;
}
function objectStringOrUndefined(object: ts.ObjectLiteralExpression | undefined, key: string): string | undefined {
  const property = object === undefined ? undefined : findProperty(object, key);
  return property !== undefined && ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : undefined;
}
function objectTransport(object: ts.ObjectLiteralExpression | undefined): string {
  const property = object === undefined ? undefined : findProperty(object, "transport");
  if (property === undefined || !ts.isPropertyAssignment(property)) return "http";
  const value = property.initializer;
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) return value.name.text.toLowerCase();
  return "http";
}
function controllerObject(call: ts.CallExpression | undefined): ts.ObjectLiteralExpression | undefined {
  const argument = call?.arguments[0];
  return argument !== undefined && ts.isObjectLiteralExpression(argument) ? argument : undefined;
}
function controllerPrefix(call: ts.CallExpression | undefined): string {
  const argument = call?.arguments[0];
  if (argument === undefined) return "";
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isObjectLiteralExpression(argument)) return objectString(argument, "prefix", "");
  return "";
}
function objectNames(object: ts.ObjectLiteralExpression | undefined, key: string): string[] {
  const property = object === undefined ? undefined : findProperty(object, key);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.map(referenceName);
}
function objectArgument(call: ts.CallExpression | undefined, index: number): ts.ObjectLiteralExpression | undefined {
  const argument = call?.arguments[index];
  return argument !== undefined && ts.isObjectLiteralExpression(argument) ? argument : undefined;
}
function objectChildObject(object: ts.ObjectLiteralExpression | undefined, key: string): ts.ObjectLiteralExpression | undefined {
  const property = object === undefined ? undefined : findProperty(object, key);
  return property !== undefined && ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer) ? property.initializer : undefined;
}
function objectReference(object: ts.ObjectLiteralExpression | undefined, key: string): string | undefined {
  const property = object === undefined ? undefined : findProperty(object, key);
  return property !== undefined && ts.isPropertyAssignment(property) ? expressionReference(property.initializer) : undefined;
}
function objectReferenceArray(object: ts.ObjectLiteralExpression | undefined, key: string): string[] {
  const property = object === undefined ? undefined : findProperty(object, key);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.map(referenceName);
}
function objectReferenceMap(object: ts.ObjectLiteralExpression | undefined, key: string): HandlerUseCaseWIR[] {
  const property = object === undefined ? undefined : findProperty(object, key);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) return [];
  const result: HandlerUseCaseWIR[] = [];
  for (const item of property.initializer.properties) {
    if (!ts.isPropertyAssignment(item)) continue;
    const name = propertyName(item.name);
    if (name === undefined) continue;
    result.push(Object.freeze({ key: name, provider: referenceName(item.initializer) }));
  }
  return result;
}
function objectBoolean(object: ts.ObjectLiteralExpression | undefined, key: string): boolean {
  const property = object === undefined ? undefined : findProperty(object, key);
  return property !== undefined && ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword;
}
function objectEnum<T extends string>(object: ts.ObjectLiteralExpression | undefined, key: string, values: readonly T[]): T | undefined {
  const property = object === undefined ? undefined : findProperty(object, key);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) return undefined;
  const value = property.initializer.text;
  return values.find((candidate) => candidate === value);
}
function findProperty(object: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyName(property.name) === key);
}
function findPropertySafe(object: ts.ObjectLiteralExpression | undefined, key: string): ts.ObjectLiteralElementLike | undefined {
  return object === undefined ? undefined : findProperty(object, key);
}
function rejectSingularMiddleware(object: ts.ObjectLiteralExpression, node: ts.Node, source: ts.SourceFile, diagnostics: CompilerDiagnostic[]): void {
  if (findProperty(object, "middleware") !== undefined || findProperty(object, "middleWares") !== undefined || findProperty(object, "middleWears") !== undefined) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Declarative Warbler APIs use "middlewares"; legacy middleware spellings are not accepted here.`, node, source, ["middlewares"]);
  }
}
function rejectForbiddenDeclarativeOptions(
  object: ts.ObjectLiteralExpression,
  keys: readonly string[],
  node: ts.Node,
  source: ts.SourceFile,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const key of keys) {
    if (findProperty(object, key) !== undefined) diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Declarative route/event option "${key}" is not allowed here. Put it on defineHandler() or the graph as appropriate.`, node, source, [key]);
  }
}
function stringArgument(call: ts.CallExpression | undefined, index: number, fallback: string): string {
  const argument = call?.arguments[index];
  return argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : fallback;
}
function parseRouteKey(key: string): { readonly method: string; readonly path: string } | undefined {
  if (key !== key.trim() || key.includes("  ")) return undefined;
  const space = key.indexOf(" ");
  if (space <= 0) return undefined;
  const method = key.slice(0, space);
  const path = key.slice(space + 1);
  if (!SUPPORTED_HTTP_METHODS.has(method) || !path.startsWith("/") || path.length < 2) return undefined;
  return Object.freeze({ method, path });
}
function parseSocketEventKey(key: string): { readonly kind: "event" | "lifecycle"; readonly event: string } | undefined {
  if (key !== key.trim()) return undefined;
  const lifecycle = DECLARATIVE_SOCKET_LIFECYCLES.get(key);
  if (lifecycle !== undefined) return Object.freeze({ kind: "lifecycle", event: lifecycle });
  if (key.startsWith("MSG ")) {
    const name = key.slice(4);
    return name.trim().length === name.length && name.length > 0 ? Object.freeze({ kind: "event", event: name }) : undefined;
  }
  if (key.startsWith("SUB ")) {
    const name = key.slice(4);
    return name.trim().length === name.length && name.length > 0 ? Object.freeze({ kind: "event", event: name }) : undefined;
  }
  return undefined;
}
function handlerOptionsFor(options: ReadonlyMap<string, HandlerOptions>, handler: string): HandlerOptions {
  return options.get(handler) ?? options.get(lastReferenceSegment(handler)) ?? EMPTY_HANDLER_OPTIONS;
}
function lastReferenceSegment(value: string): string {
  const dot = value.lastIndexOf(".");
  return dot < 0 ? value : value.slice(dot + 1);
}
function transportName(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text.toLowerCase();
  return undefined;
}
function expressionReference(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return node.getText();
  if (ts.isStringLiteralLike(node)) return JSON.stringify(node.text);
  return undefined;
}
function defaultGraphName(source: ts.SourceFile): string {
  const file = source.fileName.replaceAll("\\", "/").split("/").pop()?.replace(/\.[cm]?tsx?$/u, "") ?? "graph";
  const words = file.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  const base = words.length === 0 ? "Graph" : words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  return `${base}Graph`;
}
/**
 * Resolves a WIR-level reference name. String literals are JSON-encoded (e.g. `"cache"`) rather than
 * returned bare, so downstream phases can tell a literal token apart from an identifier by its leading
 * quote — no valid JS identifier can start with `"`, so this needs no separate marker field.
 */
function referenceName(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isStringLiteralLike(node)) return JSON.stringify(node.text);
  return node.getText();
}
function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
function location(node: ts.Node, source: ts.SourceFile): SourceLocationWIR {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: point.line + 1, column: point.character + 1 };
}
export function diagnostic(output: CompilerDiagnostic[], code: string, message: string, node: ts.Node, source: ts.SourceFile, relatedSymbols: readonly string[]): void {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  output.push(Object.freeze({ code, category: "error", message, sourceFile: source.fileName, line: point.line + 1, column: point.character + 1, relatedSymbols: Object.freeze([...relatedSymbols]) }));
}
