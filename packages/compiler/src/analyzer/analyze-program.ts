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
const PROVIDERS: ReadonlyMap<string, ProviderWIR["kind"]> = new Map([
  ["Service", "service"], ["Repository", "repository"], ["Factory", "factory"],
  ["Resolver", "resolver"], ["Gateway", "gateway"], ["Injectable", "injectable"],
]);

/** Graph declaration before ownership validation. */
export interface AnalyzedGraph extends SourceLocationWIR {
  readonly name: string; readonly prefix: string; readonly transport: string;
  readonly controllerNames: readonly string[]; readonly providerNames: readonly string[];
}
/** Complete single-pass analysis output. */
export interface AnalysisResult {
  readonly graphs: readonly AnalyzedGraph[];
  readonly controllers: ReadonlyMap<string, ControllerWIR>;
  readonly providers: ReadonlyMap<string, ProviderWIR>;
  readonly frameworkProviders: readonly FrameworkProviderReference[];
  readonly events: ReadonlyMap<string, EventWIR>;
  readonly eventListeners: ReadonlyMap<string, EventListenerWIR>;
  readonly eventInterceptors: ReadonlyMap<string, EventInterceptorWIR>;
}
/** Framework-owned provider imported by application code and registered by generated bindings. */
export interface FrameworkProviderReference extends SourceLocationWIR {
  readonly module: "@warbler/email" | "@warbler/events" | "@warbler/websocket";
  readonly imported: "Email" | "EventDispatcher" | "SocketPublisher";
  readonly local: string;
}

/** Traverses every application SourceFile once and records all Phase 1 declarations. */
export function analyzeProgram(context: CompilerContext): AnalysisResult {
  const graphs: AnalyzedGraph[] = [];
  const controllers = new Map<string, ControllerWIR>();
  const providers = new Map<string, ProviderWIR>();
  const frameworkProviders = new Map<string, FrameworkProviderReference>();
  const events = new Map<string, EventWIR>();
  const eventListeners = new Map<string, EventListenerWIR>();
  const eventInterceptors = new Map<string, EventInterceptorWIR>();

  for (const sourceFile of context.sourceFiles) {
    const aliases = collectAliases(sourceFile);
    for (const reference of collectFrameworkProviders(sourceFile)) frameworkProviders.set(reference.local, reference);
    collectEventDeclarations(sourceFile, aliases, events, eventListeners, eventInterceptors, context.diagnostics);
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
    graphs: Object.freeze(graphs),
    controllers,
    providers,
    frameworkProviders: Object.freeze([...frameworkProviders.values()]),
    events,
    eventListeners,
    eventInterceptors,
  });
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
    const result: ControllerWIR = Object.freeze({
      ...location(node, source), name, kind,
      prefix: kind === "http" ? stringArgument(controllerDecorator.call, 0, "") : "",
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
      const registration = analyzeProviderRegistration(syntheticName, element, graphName, aliases, source, diagnostics);
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
  graphName: string,
  aliases: ReadonlyMap<string, string>,
  source: ts.SourceFile,
  diagnostics: CompilerDiagnostic[],
): ProviderWIR | undefined {
  const object = call.arguments[0];
  if (object === undefined || !ts.isObjectLiteralExpression(object)) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider(...) in Graph "${graphName}" requires an object literal argument.`, call, source, [graphName]);
    return undefined;
  }
  const provideProperty = findProperty(object, "provide");
  if (provideProperty === undefined || !ts.isPropertyAssignment(provideProperty)) {
    diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider(...) in Graph "${graphName}" is missing a "provide" token.`, call, source, [graphName]);
    return undefined;
  }
  const token = referenceName(provideProperty.initializer);
  const base = { ...location(call, source), name: syntheticName, kind: "registration" as const, provide: "graph" as const, token };

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
  diagnostic(diagnostics, DiagnosticCode.INVALID_PROVIDER_SCOPE, `Provider(...) in Graph "${graphName}" must declare useClass, useValue, useFactory, or useExisting.`, call, source, [graphName]);
  return undefined;
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
      if (callee === "event") {
        events.set(name, Object.freeze({ ...location(declaration, source), name }));
        continue;
      }
      if (callee === "listen") {
        const eventArgument = call.arguments[0];
        if (eventArgument === undefined || !ts.isIdentifier(eventArgument)) {
          diagnostic(diagnostics, DiagnosticCode.INVALID_DECORATOR, `Event listener "${name}" must reference a static event symbol.`, declaration, source, [name]);
          continue;
        }
        const callback = call.arguments[1];
        listeners.set(name, Object.freeze({
          ...location(declaration, source),
          name,
          event: eventArgument.text,
          dispatches: Object.freeze(callback === undefined ? [] : collectEventDispatchEdges(callback, aliases, source)),
        }));
        continue;
      }
      if (callee === "interceptEvent") {
        interceptors.set(name, Object.freeze({ ...location(declaration, source), name }));
      }
    }
  }
}
function collectEventDispatchEdges(node: ts.Node, aliases: ReadonlyMap<string, string>, source: ts.SourceFile): readonly EventDispatchEdgeWIR[] {
  const edges: EventDispatchEdgeWIR[] = [];
  const visit = (child: ts.Node, conditional: boolean): void => {
    if (ts.isCallExpression(child) && isDispatchCall(child.expression)) {
      const first = child.arguments[0];
      if (first !== undefined && ts.isCallExpression(first) && ts.isIdentifier(first.expression)) {
        edges.push(Object.freeze({ ...location(child, source), event: first.expression.text, unconditional: !conditional }));
      }
    }
    const nextConditional = conditional || ts.isIfStatement(child) || ts.isConditionalExpression(child) || ts.isSwitchStatement(child);
    ts.forEachChild(child, (item) => visit(item, nextConditional));
  };
  visit(node, false);
  return Object.freeze(edges);
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
function objectNames(object: ts.ObjectLiteralExpression | undefined, key: string): string[] {
  const property = object === undefined ? undefined : findProperty(object, key);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.map(referenceName);
}
function objectArgument(call: ts.CallExpression | undefined, index: number): ts.ObjectLiteralExpression | undefined {
  const argument = call?.arguments[index];
  return argument !== undefined && ts.isObjectLiteralExpression(argument) ? argument : undefined;
}
function objectReference(object: ts.ObjectLiteralExpression | undefined, key: string): string | undefined {
  const property = object === undefined ? undefined : findProperty(object, key);
  return property !== undefined && ts.isPropertyAssignment(property) ? referenceName(property.initializer) : undefined;
}
function objectReferenceArray(object: ts.ObjectLiteralExpression | undefined, key: string): string[] {
  const property = object === undefined ? undefined : findProperty(object, key);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.map(referenceName);
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
function stringArgument(call: ts.CallExpression | undefined, index: number, fallback: string): string {
  const argument = call?.arguments[index];
  return argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : fallback;
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
function location(node: ts.Node, source: ts.SourceFile): SourceLocationWIR {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: point.line + 1, column: point.character + 1 };
}
export function diagnostic(output: CompilerDiagnostic[], code: string, message: string, node: ts.Node, source: ts.SourceFile, relatedSymbols: readonly string[]): void {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  output.push(Object.freeze({ code, category: "error", message, sourceFile: source.fileName, line: point.line + 1, column: point.character + 1, relatedSymbols: Object.freeze([...relatedSymbols]) }));
}
