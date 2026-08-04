import { relative } from "node:path";
import ts from "typescript";
import { BindingDiagnosticCode, bindingDiagnostic } from "../diagnostics/binding-diagnostics";
import type { OptimizedApplication } from "../output/artifact-types";
import type { CompilerContext } from "../project/compiler-context";
import type { ApplicationWIR, ControllerWIR, ProviderWIR } from "../wir/wir";

/** One deterministic ESM value import required by generated executable code. */
export interface BindingImport {
  readonly local: string;
  readonly imported: string;
  readonly kind: "default" | "named";
  readonly module: string;
}
export interface ProviderBindingPlan {
  readonly id: number; readonly graphId: number; readonly scope: "graph" | "root";
  readonly dependencyIds: readonly number[]; readonly symbol: BindingImport;
  readonly dependencySymbols: readonly BindingImport[];
}
export interface ControllerBindingPlan {
  readonly id: number; readonly graphId: number; readonly transport: "http" | "websocket"; readonly symbol: BindingImport;
}
export interface HandlerBindingPlan {
  readonly id: number; readonly controllerId: number; readonly method: string; readonly controller: BindingImport;
}
export interface ExecutableBindingPlan {
  readonly providers: readonly ProviderBindingPlan[];
  readonly controllers: readonly ControllerBindingPlan[];
  readonly handlers: readonly HandlerBindingPlan[];
  readonly guards: readonly (BindingImport & { readonly id: number })[];
  readonly middlewares: readonly (BindingImport & { readonly id: number })[];
  readonly validators: readonly (BindingImport & { readonly id: number })[];
}

/** Resolves WIR names to exported runtime values using the compilation TypeChecker. */
export function analyzeExecutableBindings(
  context: CompilerContext,
  wir: ApplicationWIR,
  optimized: OptimizedApplication,
): ExecutableBindingPlan | undefined {
  const declarations = collectDeclarations(context);
  const providerOwners = new Map<string, { readonly graph: string; readonly provider: ProviderWIR }>();
  for (const provider of wir.rootProviders) providerOwners.set(`root:${provider.name}`, { graph: "", provider });
  for (const graph of wir.graphs) for (const provider of graph.providers) providerOwners.set(`${graph.name}:${provider.name}`, { graph: graph.name, provider });
  const controllerOwners = new Map<string, { readonly graph: string; readonly controller: ControllerWIR }>();
  for (const graph of wir.graphs) for (const controller of graph.controllers) controllerOwners.set(`${graph.name}:${controller.name}`, { graph: graph.name, controller });

  const imports = new Map<string, BindingImport>();
  const resolveValue = (name: string, preferredFile?: string): BindingImport | undefined => {
    const candidates = (declarations.get(name) ?? []).filter((node) => preferredFile === undefined || node.getSourceFile().fileName === preferredFile);
    if (candidates.length !== 1) {
      context.diagnostics.push(bindingDiagnostic(
        candidates.length === 0 ? BindingDiagnosticCode.SYMBOL_NOT_FOUND : BindingDiagnosticCode.IMPORT_UNRESOLVED,
        `Executable binding symbol "${name}" ${candidates.length === 0 ? "was not found" : "is ambiguous"}.`,
        preferredFile ?? "", name,
      ));
      return undefined;
    }
    const declaration = candidates[0]!;
    if (isTypeOnly(declaration)) {
      context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.NOT_EXPORTED, `Executable binding "${name}" is type-only.`, declaration.getSourceFile().fileName, name));
      return undefined;
    }
    const kind = exportKind(declaration);
    if (kind === undefined) {
      context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.NOT_EXPORTED, `Executable binding "${name}" is not exported.`, declaration.getSourceFile().fileName, name));
      return undefined;
    }
    const declaredName = declarationName(declaration);
    const imported = declaredName !== undefined && ts.isIdentifier(declaredName) ? declaredName.text : name;
    const key = `${declaration.getSourceFile().fileName}:${imported}`;
    const existing = imports.get(key);
    if (existing !== undefined) return existing;
    const module = generatedImportPath(context.config.projectRoot, declaration.getSourceFile().fileName);
    const value = Object.freeze({ local: safeLocal(name, imports.size), imported, kind, module });
    imports.set(key, value);
    return value;
  };

  let failed = false;
  const providers: ProviderBindingPlan[] = [];
  for (const row of optimized.providers) {
    const name = optimized.strings[row.nameId]!;
    const ownerEntry = [...providerOwners.entries()].find(([key]) => key === (row.root ? `root:${name}` : `${graphName(optimized, row.graphId)}:${name}`));
    if (ownerEntry === undefined) { failed = true; continue; }
    const owner = ownerEntry[1];
    const symbol = resolveValue(name, owner.provider.file);
    if (symbol === undefined) { failed = true; continue; }
    const dependencyIds = optimized.providerDependencies.slice(row.dependencyStart, row.dependencyStart + row.dependencyCount);
    const dependencySymbols = owner.provider.dependencies.map((dependency) => resolveValue(dependency)).filter(isImport);
    if (dependencySymbols.length !== owner.provider.dependencies.length) failed = true;
    providers.push(Object.freeze({ id: row.id, graphId: row.graphId, scope: row.root ? "root" : "graph", dependencyIds: Object.freeze(dependencyIds), symbol, dependencySymbols: Object.freeze(dependencySymbols) }));
  }
  const controllers: ControllerBindingPlan[] = [];
  for (const row of optimized.controllers) {
    const name = optimized.strings[row.nameId]!;
    const owner = controllerOwners.get(`${graphName(optimized, row.graphId)}:${name}`);
    const symbol = owner === undefined ? undefined : resolveValue(name, owner.controller.file);
    if (owner === undefined || symbol === undefined) { failed = true; continue; }
    controllers.push(Object.freeze({ id: row.id, graphId: row.graphId, transport: row.websocket ? "websocket" : "http", symbol }));
  }
  const handlers: HandlerBindingPlan[] = [];
  for (const row of optimized.handlers) {
    const qualified = optimized.strings[row.nameId]!;
    const dot = qualified.lastIndexOf(".");
    const ownerName = qualified.slice(0, dot);
    const method = qualified.slice(dot + 1);
    const controllerName = ownerName.slice(ownerName.indexOf(":") + 1);
    const controllerRow = optimized.controllers.find((item) => optimized.strings[item.nameId] === controllerName);
    const controller = controllerRow === undefined ? undefined : controllers.find((item) => item.id === controllerRow.id);
    const declaration = (declarations.get(controllerName) ?? []).find(ts.isClassDeclaration);
    const member = declaration?.members.find((item) => ts.isMethodDeclaration(item) && item.name !== undefined && item.name.getText() === method);
    if (controller === undefined || declaration === undefined || member === undefined || hasModifier(member, ts.SyntaxKind.StaticKeyword) || hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
      context.diagnostics.push(bindingDiagnostic(BindingDiagnosticCode.HANDLER_NOT_FOUND, `Executable handler "${qualified}" is missing or invalid.`, declaration?.getSourceFile().fileName ?? "", qualified));
      failed = true; continue;
    }
    handlers.push(Object.freeze({ id: row.id, controllerId: controller.id, method, controller: controller.symbol }));
  }
  const namedBindings = (rows: readonly { readonly id: number; readonly nameId: number }[]) => rows.map((row) => {
    const name = optimized.strings[row.nameId]!;
    const symbol = resolveValue(name);
    if (symbol === undefined) { failed = true; return undefined; }
    return Object.freeze({ ...symbol, id: row.id });
  }).filter(isDefined);
  const result = Object.freeze({
    providers: Object.freeze(providers), controllers: Object.freeze(controllers), handlers: Object.freeze(handlers),
    guards: Object.freeze(namedBindings(optimized.guards)),
    middlewares: Object.freeze(namedBindings(optimized.middlewares)),
    validators: Object.freeze(namedBindings(optimized.validators)),
  });
  return failed ? undefined : result;
}

function collectDeclarations(context: CompilerContext): ReadonlyMap<string, readonly ts.Declaration[]> {
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
        if (targetDeclarations.length > 0) result.set(binding.text, [...targetDeclarations]);
      }
    }
  }
  return result;
}
function exportKind(node: ts.Declaration): BindingImport["kind"] | undefined {
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
function declarationName(node: ts.Declaration): ts.DeclarationName | undefined {
  if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) return node.name;
  return undefined;
}
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean { return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false); }
function isTypeOnly(node: ts.Declaration): boolean { return ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node); }
function generatedImportPath(root: string, file: string): string {
  const path = relative(`${root}/.warbler/generated`, file).replaceAll("\\", "/").replace(/\.(?:tsx?|mts|cts)$/u, "");
  return path.startsWith(".") ? path : `./${path}`;
}
function graphName(optimized: OptimizedApplication, id: number): string {
  return Object.entries(optimized.graphIds).find(([, value]) => value === id)?.[0] ?? "";
}
function safeLocal(name: string, index: number): string { return `Binding${index}_${name.replace(/[^A-Za-z0-9_$]/gu, "_")}`; }
function isImport(value: BindingImport | undefined): value is BindingImport { return value !== undefined; }
function isDefined<T>(value: T | undefined): value is T { return value !== undefined; }
