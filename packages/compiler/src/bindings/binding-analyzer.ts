import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { BindingDiagnosticCode, bindingDiagnostic } from "../diagnostics/binding-diagnostics";
import type { OptimizedApplication } from "../output/artifact-types";
import type { CompilerContext } from "../project/compiler-context";
import type { ApplicationWIR, CapturedExpressionWIR, ControllerWIR, HandlerUseCaseWIR, ProviderWIR } from "../wir/wir";

/** One deterministic ESM value import required by generated executable code. */
export interface BindingImport {
  readonly local: string;
  readonly imported: string;
  readonly kind: "default" | "named" | "namespace";
  readonly module: string;
}
/** A verbatim-captured expression plus the resolved imports its free identifiers require. */
export interface CapturedBindingExpression {
  readonly text: string;
  readonly imports: readonly BindingImport[];
}
/** A bare string/symbol token embedded directly in generated source — it has no declaration to import. */
export interface LiteralTokenReference {
  readonly kind: "literal";
  readonly expression: string;
}
/** A provider/existing token: either an imported declaration or an inline literal. */
export type TokenReference = BindingImport | LiteralTokenReference;
export interface ProviderBindingPlan {
  readonly id: number; readonly graphId: number; readonly controllerId?: number; readonly scope: "graph" | "root" | "request" | "controller";
  readonly registration: "class" | "useValue" | "useFactory" | "useExisting";
  readonly dependencyIds: readonly number[]; readonly token: TokenReference;
  readonly implementation?: BindingImport;
  readonly capturedValue?: CapturedBindingExpression;
  readonly capturedFactory?: CapturedBindingExpression;
  readonly existing?: TokenReference;
  readonly dependencySymbols: readonly BindingImport[];
}
export interface ControllerBindingPlan {
  readonly id: number; readonly graphId: number; readonly transport: "http" | "websocket"; readonly symbol: BindingImport; readonly providerIds: readonly number[];
}
export type HandlerBindingPlan =
  | { readonly kind: "method"; readonly id: number; readonly controllerId: number; readonly method: string; readonly controller: BindingImport; readonly parameterCount: number }
  | { readonly kind: "function"; readonly id: number; readonly graphId: number; readonly expression: CapturedBindingExpression; readonly parameterCount: number; readonly useCaseKeys: readonly string[]; readonly useCaseProviderIds: readonly number[] };
export interface ExecutableBindingPlan {
  readonly providers: readonly ProviderBindingPlan[];
  readonly controllers: readonly ControllerBindingPlan[];
  readonly handlers: readonly HandlerBindingPlan[];
  readonly guards: readonly (BindingImport & { readonly id: number })[];
  readonly middlewares: readonly (BindingImport & { readonly id: number })[];
  readonly validators: readonly (BindingImport & { readonly id: number })[];
  readonly events: readonly (BindingImport & { readonly id: number; readonly file: string; readonly line: number; readonly column: number })[];
  readonly eventListeners: readonly (BindingImport & { readonly id: number; readonly eventId: number; readonly file: string; readonly line: number; readonly column: number })[];
  readonly eventInterceptors: readonly (BindingImport & { readonly id: number; readonly file: string; readonly line: number; readonly column: number })[];
}

/** Resolves WIR names to exported runtime values using the compilation TypeChecker. */
export function analyzeExecutableBindings(
  context: CompilerContext,
  wir: ApplicationWIR,
  optimized: OptimizedApplication,
): ExecutableBindingPlan | undefined {
  const declarations = collectDeclarations(context);
  const namespaceImports = collectNamespaceImports(context);
  const providerOwners = new Map<string, { readonly graph: string; readonly provider: ProviderWIR }>();
  for (const provider of wir.rootProviders) providerOwners.set(`root:${provider.name}`, { graph: "", provider });
  for (const graph of wir.graphs) for (const provider of graph.providers) providerOwners.set(`${graph.name}:${provider.name}`, { graph: graph.name, provider });
  for (const graph of wir.graphs) for (const controller of graph.controllers) for (const provider of controller.providers) {
    providerOwners.set(`${graph.name}:${controller.name}:${provider.name}`, { graph: graph.name, provider });
  }
  const controllerOwners = new Map<string, { readonly graph: string; readonly controller: ControllerWIR }>();
  for (const graph of wir.graphs) for (const controller of graph.controllers) controllerOwners.set(`${graph.name}:${controller.name}`, { graph: graph.name, controller });
  const handlerOwners = new Map<string, { readonly graph: string; readonly controller: ControllerWIR; readonly file: string; readonly handler: string; readonly useCases: readonly HandlerUseCaseWIR[] }>();
  for (const graph of wir.graphs) for (const controller of graph.controllers) {
    for (const route of controller.routes) handlerOwners.set(`${graph.name}:${controller.name}.${route.handler}`, { graph: graph.name, controller, file: route.file, handler: route.handler, useCases: route.useCases });
    for (const event of controller.socketEvents) handlerOwners.set(`${graph.name}:${controller.name}.${event.handler}`, { graph: graph.name, controller, file: event.file, handler: event.handler, useCases: event.useCases });
  }

  const imports = new Map<string, BindingImport>();
  const resolveValue = (name: string, preferredFile?: string, silent = false): BindingImport | undefined => {
    const framework = resolveFrameworkValue(name, preferredFile, imports);
    if (framework !== undefined) return framework;
    const namespace = namespaceImports.get(name)?.find((item) => preferredFile === undefined || item.file === preferredFile);
    if (namespace !== undefined) {
      const key = `${namespace.module}:*:${name}`;
      const existing = imports.get(key);
      if (existing !== undefined) return existing;
      const value = Object.freeze({ local: safeLocal(name, imports.size), imported: "*", kind: "namespace" as const, module: namespace.module });
      imports.set(key, value);
      return value;
    }
    const candidates = (declarations.get(name) ?? []).filter((node) => preferredFile === undefined || node.getSourceFile().fileName === preferredFile);
    if (candidates.length !== 1) {
      if (!silent) context.diagnostics.push(bindingDiagnostic(
        candidates.length === 0 ? BindingDiagnosticCode.SYMBOL_NOT_FOUND : BindingDiagnosticCode.IMPORT_UNRESOLVED,
        `Executable binding symbol "${name}" ${candidates.length === 0 ? "was not found" : "is ambiguous"}.`,
        preferredFile ?? "", name,
      ));
      return undefined;
    }
    const declaration = candidates[0]!;
    if (isTypeOnly(declaration)) {
      if (!silent) context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.NOT_EXPORTED, `Executable binding "${name}" is type-only.`, declaration.getSourceFile().fileName, name));
      return undefined;
    }
    const kind = exportKind(declaration);
    if (kind === undefined) {
      if (!silent) context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.NOT_EXPORTED, `Executable binding "${name}" is not exported.`, declaration.getSourceFile().fileName, name));
      return undefined;
    }
    const declaredName = declarationName(declaration);
    const imported = declaredName !== undefined && ts.isIdentifier(declaredName) ? declaredName.text : name;
    const frameworkDeclaration = resolveFrameworkDeclaration(name, declaration, imported, imports);
    if (frameworkDeclaration !== undefined) return frameworkDeclaration;
    const key = `${declaration.getSourceFile().fileName}:${imported}`;
    const existing = imports.get(key);
    if (existing !== undefined) return existing;
    const module = generatedImportPath(context.config.projectRoot, declaration.getSourceFile().fileName);
    const value = Object.freeze({ local: safeLocal(name, imports.size), imported, kind, module });
    imports.set(key, value);
    return value;
  };
  /** Resolves a captured free identifier to an import when it's a user declaration; globals (console, Math, ...) silently resolve to nothing. */
  const resolveCaptured = (captured: CapturedExpressionWIR | undefined): CapturedBindingExpression | undefined => {
    if (captured === undefined) return undefined;
    const capturedImports = captured.captures.filter((name) => !isLiteralReference(name)).map((name) => resolveValue(name, undefined, true)).filter(isImport);
    return Object.freeze({ text: captured.text, imports: Object.freeze(capturedImports) });
  };
  /** Resolves a token/dependency name to an import, or — for a bare string/symbol literal, which has no declaration — an inline literal. */
  const resolveToken = (name: string, preferredFile?: string): TokenReference | undefined =>
    isLiteralReference(name) ? Object.freeze({ kind: "literal" as const, expression: name }) : resolveValue(name, preferredFile);

  let failed = false;
  const providers: ProviderBindingPlan[] = [];
  for (const row of optimized.providers) {
    const name = optimized.strings[row.nameId]!;
    const rowGraphName = graphName(optimized, row.graphId);
    const rowControllerName = row.controllerId === undefined ? "" : controllerName(optimized, row.controllerId);
    const ownerKey = row.scope === "root" ? `root:${name}` : row.scope === "controller" ? `${rowGraphName}:${rowControllerName}:${name}` : `${rowGraphName}:${name}`;
    const owner = providerOwners.get(ownerKey);
    if (owner === undefined) { failed = true; continue; }
    const provider = owner.provider;
    const token = resolveToken(provider.token ?? provider.name);
    if (token === undefined) { failed = true; continue; }
    const dependencyIds = optimized.providerDependencies.slice(row.dependencyStart, row.dependencyStart + row.dependencyCount);
    const identifierDependencies = provider.dependencies.filter((dependency) => !isLiteralReference(dependency));
    const dependencySymbols = identifierDependencies.map((dependency) => resolveValue(dependency)).filter(isImport);
    if (dependencySymbols.length !== identifierDependencies.length) failed = true;

    const registration = provider.registration;
    const implementation = registration === "class" ? resolveValue(provider.implementation ?? provider.name, provider.file) : undefined;
    if (registration === "class" && implementation === undefined) failed = true;
    const existing = registration === "useExisting" && provider.existing !== undefined ? resolveToken(provider.existing) : undefined;
    if (registration === "useExisting" && existing === undefined) failed = true;
    const capturedValue = registration === "useValue" ? resolveCaptured(provider.capturedValue) : undefined;
    const capturedFactory = registration === "useFactory" ? resolveCaptured(provider.capturedFactory) : undefined;

    providers.push(Object.freeze({
      id: row.id, graphId: row.graphId, ...(row.controllerId === undefined ? {} : { controllerId: row.controllerId }), scope: row.scope, registration,
      dependencyIds: Object.freeze(dependencyIds), token,
      ...(implementation === undefined ? {} : { implementation }),
      ...(capturedValue === undefined ? {} : { capturedValue }),
      ...(capturedFactory === undefined ? {} : { capturedFactory }),
      ...(existing === undefined ? {} : { existing }),
      dependencySymbols: Object.freeze(dependencySymbols),
    }));
  }
  const controllers: ControllerBindingPlan[] = [];
  for (const row of optimized.controllers) {
    const name = optimized.strings[row.nameId]!;
    const owner = controllerOwners.get(`${graphName(optimized, row.graphId)}:${name}`);
    if (owner?.controller.synthetic === true) continue;
    const symbol = owner === undefined ? undefined : resolveValue(name, owner.controller.file);
    if (owner === undefined || symbol === undefined) { failed = true; continue; }
    const providerIds = optimized.providers.filter((provider) => provider.scope === "controller" && provider.controllerId === row.id).map((provider) => provider.id);
    controllers.push(Object.freeze({ id: row.id, graphId: row.graphId, transport: row.websocket ? "websocket" : "http", symbol, providerIds: Object.freeze(providerIds) }));
  }
  const handlers: HandlerBindingPlan[] = [];
  for (const row of optimized.handlers) {
    const qualified = optimized.strings[row.nameId]!;
    const handlerOwner = handlerOwners.get(qualified);
    if (handlerOwner?.controller.synthetic === true) {
      const expression = resolveHandlerExpression(handlerOwner.handler, handlerOwner.file, resolveValue);
      if (expression === undefined) { failed = true; continue; }
      const graphId = optimized.graphIds[handlerOwner.graph]!;
      const useCaseProviderIds = resolveUseCaseProviderIds(optimized, handlerOwner.useCases, graphId);
      if (useCaseProviderIds.length !== handlerOwner.useCases.length) {
        context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.SYMBOL_NOT_FOUND, `Executable handler "${qualified}" references an unknown use case provider.`, handlerOwner.file, qualified));
        failed = true;
        continue;
      }
      handlers.push(Object.freeze({
        kind: "function",
        id: row.id,
        graphId,
        expression,
        parameterCount: handlerOwner.useCases.length === 0 ? 1 : 2,
        useCaseKeys: Object.freeze(handlerOwner.useCases.map((item) => item.key)),
        useCaseProviderIds: Object.freeze(useCaseProviderIds),
      }));
      continue;
    }
    const dot = qualified.lastIndexOf(".");
    const ownerName = qualified.slice(0, dot);
    const method = qualified.slice(dot + 1);
    const controllerName = ownerName.slice(ownerName.indexOf(":") + 1);
    const controllerRow = optimized.controllers.find((item) => optimized.strings[item.nameId] === controllerName);
    const controller = controllerRow === undefined ? undefined : controllers.find((item) => item.id === controllerRow.id);
    const declaration = (declarations.get(controllerName) ?? []).find(ts.isClassDeclaration);
    const classElement = declaration?.members.find((item) => ts.isMethodDeclaration(item) && item.name !== undefined && item.name.getText() === method);
    const member = classElement !== undefined && ts.isMethodDeclaration(classElement) ? classElement : undefined;
    if (controller === undefined || declaration === undefined || member === undefined || hasModifier(member, ts.SyntaxKind.StaticKeyword) || hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
      context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.HANDLER_NOT_FOUND, `Executable handler "${qualified}" is missing or invalid.`, declaration?.getSourceFile().fileName ?? "", qualified));
      failed = true; continue;
    }
    handlers.push(Object.freeze({ kind: "method", id: row.id, controllerId: controller.id, method, controller: controller.symbol, parameterCount: member.parameters.length }));
  }
  const namedBindings = (rows: readonly { readonly id: number; readonly nameId: number }[]) => rows.map((row) => {
    const name = optimized.strings[row.nameId]!;
    const symbol = resolveValue(name);
    if (symbol === undefined) { failed = true; return undefined; }
    return Object.freeze({ ...symbol, id: row.id });
  }).filter(isDefined);
  const eventBindings = optimized.events.map((row) => {
    const name = optimized.strings[row.nameId]!;
    const file = optimized.strings[row.fileId]!;
    const symbol = resolveValue(name, file);
    if (symbol === undefined) { failed = true; return undefined; }
    return Object.freeze({ ...symbol, id: row.id, file, line: row.line, column: row.column });
  }).filter(isDefined);
  const listenerBindings = optimized.eventListeners.map((row) => {
    const name = optimized.strings[row.nameId]!;
    const file = optimized.strings[row.fileId]!;
    const symbol = resolveValue(name, file);
    if (symbol === undefined) { failed = true; return undefined; }
    return Object.freeze({ ...symbol, id: row.id, eventId: row.eventId, file, line: row.line, column: row.column });
  }).filter(isDefined);
  const interceptorBindings = optimized.eventInterceptors.map((row) => {
    const name = optimized.strings[row.nameId]!;
    const file = optimized.strings[row.fileId]!;
    const symbol = resolveValue(name, file);
    if (symbol === undefined) { failed = true; return undefined; }
    return Object.freeze({ ...symbol, id: row.id, file, line: row.line, column: row.column });
  }).filter(isDefined);
  const result = Object.freeze({
    providers: Object.freeze(providers), controllers: Object.freeze(controllers), handlers: Object.freeze(handlers),
    guards: Object.freeze(namedBindings(optimized.guards)),
    middlewares: Object.freeze(namedBindings(optimized.middlewares)),
    validators: Object.freeze(namedBindings(optimized.validators)),
    events: Object.freeze(eventBindings),
    eventListeners: Object.freeze(listenerBindings),
    eventInterceptors: Object.freeze(interceptorBindings),
  });
  return failed ? undefined : result;
}

/** Maps every top-level declaration name (and every imported binding name) in the application to its declaration node(s). */
export function collectDeclarations(context: CompilerContext): ReadonlyMap<string, readonly ts.Declaration[]> {
  const result = new Map<string, ts.Declaration[]>();
  for (const source of context.sourceFiles) {
    const visit = (node: ts.Node): void => {
      if ((ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name !== undefined && ts.isIdentifier(node.name)) {
        const current = result.get(node.name.text) ?? []; current.push(node); result.set(node.name.text, current);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
      const bindings: ts.Identifier[] = [];
      if (statement.importClause.name !== undefined) bindings.push(statement.importClause.name);
      const named = statement.importClause.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) for (const element of named.elements) bindings.push(element.name);
      if (named !== undefined && ts.isNamespaceImport(named)) bindings.push(named.name);
      for (const binding of bindings) {
        const symbol = context.typeChecker.getSymbolAtLocation(binding);
        const target = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? context.typeChecker.getAliasedSymbol(symbol) : symbol;
        const targetDeclarations = target?.declarations ?? [];
        if (targetDeclarations.length > 0) {
          const current = result.get(binding.text) ?? [];
          result.set(binding.text, uniqueDeclarations([...current, ...targetDeclarations]));
        }
      }
    }
  }
  return result;
}
interface NamespaceImportReference {
  readonly file: string;
  readonly module: string;
}
function collectNamespaceImports(context: CompilerContext): ReadonlyMap<string, readonly NamespaceImportReference[]> {
  const result = new Map<string, NamespaceImportReference[]>();
  for (const source of context.sourceFiles) {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.namedBindings === undefined || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause.namedBindings;
      if (!ts.isNamespaceImport(bindings)) continue;
      const current = result.get(bindings.name.text) ?? [];
      current.push(Object.freeze({ file: source.fileName, module: namespaceImportModule(context.config.projectRoot, source.fileName, statement.moduleSpecifier.text) }));
      result.set(bindings.name.text, current);
    }
  }
  return result;
}
function namespaceImportModule(root: string, sourceFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const absolute = resolve(dirname(sourceFile), specifier);
  return generatedImportPath(root, absolute);
}
function resolveHandlerExpression(
  text: string,
  preferredFile: string,
  resolveValue: (name: string, preferredFile?: string, silent?: boolean) => BindingImport | undefined,
): CapturedBindingExpression | undefined {
  const root = /^[$A-Z_a-z][$\w]*/u.exec(text)?.[0];
  if (root === undefined) return undefined;
  const binding = resolveValue(root, preferredFile, true) ?? resolveValue(root);
  if (binding === undefined) return undefined;
  const suffix = text.slice(root.length);
  return Object.freeze({ text: `${binding.local}${suffix}`, imports: Object.freeze([binding]) });
}
function resolveUseCaseProviderIds(
  optimized: OptimizedApplication,
  useCases: readonly HandlerUseCaseWIR[],
  graphId: number,
): readonly number[] {
  const result: number[] = [];
  for (const useCase of useCases) {
    const id = providerIdFor(optimized, useCase.provider, graphId);
    if (id === undefined) return Object.freeze(result);
    result.push(id);
  }
  return Object.freeze(result);
}
function providerIdFor(optimized: OptimizedApplication, name: string, graphId: number): number | undefined {
  for (const provider of optimized.providers) {
    if (optimized.strings[provider.nameId] !== name) continue;
    if (provider.scope === "root" || provider.graphId === graphId) return provider.id;
  }
  return undefined;
}
/** Determines whether a declaration is exported, and if so, whether it's the module's default export. */
export function exportKind(node: ts.Declaration): BindingImport["kind"] | undefined {
  const statement = nearestStatement(node);
  if (statement !== undefined && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return "default";
  if (statement !== undefined && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return "named";
  const source = node.getSourceFile();
  const nameNode = declarationName(node);
  const name = nameNode !== undefined && ts.isIdentifier(nameNode) ? nameNode.text : "";
  for (const item of source.statements) {
    if (!ts.isExportDeclaration(item) || item.exportClause === undefined || !ts.isNamedExports(item.exportClause)) continue;
    if (item.exportClause.elements.some((element) => (element.propertyName?.text ?? element.name.text) === name && !item.isTypeOnly && !element.isTypeOnly)) return "named";
  }
  return undefined;
}
function nearestStatement(node: ts.Node): ts.Statement | undefined {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isStatement(current)) current = current.parent;
  return current;
}
/** The declared identifier name for declaration kinds where the export name can differ from the lookup key (aliased imports). */
export function declarationName(node: ts.Declaration): ts.DeclarationName | undefined {
  if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) return node.name;
  return undefined;
}
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean { return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false); }
function isTypeOnly(node: ts.Declaration): boolean { return ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node); }
function uniqueDeclarations(declarations: readonly ts.Declaration[]): ts.Declaration[] {
  const seen = new Set<string>();
  const result: ts.Declaration[] = [];
  for (const declaration of declarations) {
    const key = `${declaration.getSourceFile().fileName}:${declaration.pos}:${declaration.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(declaration);
  }
  return result;
}
/** Resolves the relative import specifier a `.warbler/generated` module uses to reach a source declaration. */
export function generatedImportPath(root: string, file: string): string {
  const path = relative(`${root}/.warbler/generated`, file).replaceAll("\\", "/").replace(/\.(?:tsx?|mts|cts)$/u, "");
  return path.startsWith(".") ? path : `./${path}`;
}
function graphName(optimized: OptimizedApplication, id: number): string {
  return Object.entries(optimized.graphIds).find(([, value]) => value === id)?.[0] ?? "";
}
function controllerName(optimized: OptimizedApplication, id: number): string {
  const row = optimized.controllers.find((controller) => controller.id === id);
  return row === undefined ? "" : optimized.strings[row.nameId] ?? "";
}
/** Produces a collision-safe local identifier for a generated import binding. */
export function safeLocal(name: string, index: number): string { return `Binding${index}_${name.replace(/[^A-Za-z0-9_$]/gu, "_")}`; }
function isImport(value: BindingImport | undefined): value is BindingImport { return value !== undefined; }
function isDefined<T>(value: T | undefined): value is T { return value !== undefined; }
/** A WIR reference name produced from a string-literal token (see `referenceName` in the analyzer) starts with `"`, which no identifier can. */
function isLiteralReference(name: string): boolean { return name.startsWith("\""); }
function resolveFrameworkValue(name: string, preferredFile: string | undefined, imports: Map<string, BindingImport>): BindingImport | undefined {
  if (preferredFile === "@warbler/websocket" && name === "SocketPublisher") return frameworkImport(name, "SocketPublisher", "@warbler/websocket", imports);
  if (preferredFile === "@warbler/events" && name === "EventDispatcher") return frameworkImport(name, "EventDispatcher", "@warbler/events", imports);
  if (preferredFile === "@warbler/email" && name === "Email") return frameworkImport(name, "Email", "@warbler/email", imports);
  return undefined;
}
function resolveFrameworkDeclaration(name: string, declaration: ts.Declaration, imported: string, imports: Map<string, BindingImport>): BindingImport | undefined {
  const source = declaration.getSourceFile().fileName.replaceAll("\\", "/");
  if (imported === "SocketPublisher" && source.endsWith("/packages/websocket/src/publisher.ts")) return frameworkImport(name, "SocketPublisher", "@warbler/websocket", imports);
  if (imported === "EventDispatcher" && source.endsWith("/packages/events/src/index.ts")) return frameworkImport(name, "EventDispatcher", "@warbler/events", imports);
  if (imported === "Email" && source.endsWith("/packages/email/src/email.ts")) return frameworkImport(name, "Email", "@warbler/email", imports);
  return undefined;
}
function frameworkImport(name: string, imported: string, module: string, imports: Map<string, BindingImport>): BindingImport {
  const key = `${module}:${imported}`;
  const existing = imports.get(key);
  if (existing !== undefined) return existing;
  const value = Object.freeze({
    local: safeLocal(name, imports.size),
    imported,
    kind: "named" as const,
    module,
  });
  imports.set(key, value);
  return value;
}
