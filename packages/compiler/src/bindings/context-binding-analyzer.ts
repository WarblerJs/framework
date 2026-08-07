import ts from "typescript";
import { diagnostic } from "../analyzer/analyze-program";
import { DiagnosticCode } from "../diagnostics/diagnostic";
import type { OptimizedApplication } from "../output/artifact-types";
import type { CompilerContext } from "../project/compiler-context";
import {
  collectDeclarations, declarationName, exportKind, generatedImportPath,
  type BindingImport,
} from "./binding-analyzer";

/** One key of the generated `WarblerRequestContext` interface, with its resolved value type and imports. */
export interface ContextEntryBindingPlan {
  readonly key: string;
  readonly typeText: string;
  readonly imports: readonly BindingImport[];
}

/**
 * Walks every guard/middleware referenced by the application for `context.set(...)`
 * calls whose `context` receiver resolves to that function's second parameter,
 * extracting `{key, type}` pairs used to generate the app-wide `WarblerRequestContext`
 * interface. Must run after bindings/optimize so guard/middleware names — and their
 * real declarations — are known.
 */
export function analyzeContextBindings(context: CompilerContext, optimized: OptimizedApplication): readonly ContextEntryBindingPlan[] {
  const declarations = collectDeclarations(context);
  const names = new Set<string>();
  for (const row of optimized.guards) names.add(optimized.strings[row.nameId]!);
  for (const row of optimized.middlewares) names.add(optimized.strings[row.nameId]!);

  const typesByKey = new Map<string, Set<string>>();
  const capturesByKey = new Map<string, Set<string>>();
  for (const name of names) {
    for (const declaration of declarations.get(name) ?? []) {
      const fn = functionLikeDeclaration(declaration);
      if (fn !== undefined) analyzeFunctionBody(context, fn, typesByKey, capturesByKey);
    }
  }

  // Imported under its own bare name (not a `Binding{n}_`-aliased local, unlike other
  // generated files): the printed type text below reproduces the type's own declared
  // name verbatim, so the import's local binding must match it exactly. This is safe
  // because `collectDeclarations` already requires exactly one project-wide
  // declaration per bare name before it resolves — two distinct same-named types from
  // different files are ambiguous and silently skipped below, never both imported.
  const imports = new Map<string, BindingImport>();
  const resolveCapturedType = (name: string): BindingImport | undefined => {
    const candidates = declarations.get(name) ?? [];
    if (candidates.length !== 1) return undefined; // ambiguous or a lib/global type — no import needed, or unresolvable (silently skipped, like captured-expression globals elsewhere)
    const found = candidates[0]!;
    const kind = exportKind(found);
    if (kind === undefined) return undefined; // not exported — the generated .d.ts import would fail; skip rather than emit broken output
    const declared = declarationName(found);
    const imported = declared !== undefined && ts.isIdentifier(declared) ? declared.text : name;
    const key = `${found.getSourceFile().fileName}:${imported}`;
    const existing = imports.get(key);
    if (existing !== undefined) return existing;
    const module = generatedImportPath(context.config.projectRoot, found.getSourceFile().fileName);
    const value = Object.freeze({ local: imported, imported, kind, module });
    imports.set(key, value);
    return value;
  };

  return Object.freeze([...typesByKey.entries()].sort(([a], [b]) => compareText(a, b)).map(([key, typeTexts]) => {
    const captures = [...(capturesByKey.get(key) ?? [])].sort(compareText);
    const resolvedImports = captures.map(resolveCapturedType).filter(isImport);
    return Object.freeze({
      key,
      typeText: [...typeTexts].sort(compareText).join(" | "),
      imports: Object.freeze(resolvedImports),
    });
  }));
}

function functionLikeDeclaration(declaration: ts.Declaration): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration | undefined {
  if (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration) || ts.isMethodDeclaration(declaration)) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
    return declaration.initializer;
  }
  return undefined;
}

function analyzeFunctionBody(
  context: CompilerContext,
  fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
  typesByKey: Map<string, Set<string>>,
  capturesByKey: Map<string, Set<string>>,
): void {
  const contextParam = fn.parameters[1];
  if (contextParam === undefined || !ts.isIdentifier(contextParam.name) || fn.body === undefined) return;
  const contextSymbol = context.typeChecker.getSymbolAtLocation(contextParam.name);
  if (contextSymbol === undefined) return;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isContextSetCall(node, contextSymbol, context.typeChecker)) {
      handleSetCall(context, node, typesByKey, capturesByKey);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
}

function isContextSetCall(call: ts.CallExpression, contextSymbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "set") return false;
  return checker.getSymbolAtLocation(call.expression.expression) === contextSymbol;
}

function handleSetCall(
  context: CompilerContext,
  call: ts.CallExpression,
  typesByKey: Map<string, Set<string>>,
  capturesByKey: Map<string, Set<string>>,
): void {
  const keyArgument = call.arguments[0];
  if (keyArgument === undefined || !ts.isStringLiteralLike(keyArgument)) {
    diagnostic(
      context.diagnostics, DiagnosticCode.INVALID_CONTEXT_KEY,
      "context.set(...) requires a string literal key to generate a typed WarblerRequestContext.",
      call, call.getSourceFile(), [],
    );
    return;
  }
  const type = resolveSetValueType(context, call);
  if (type === undefined) return;
  const typeNode = context.typeChecker.typeToTypeNode(type, call, ts.NodeBuilderFlags.NoTruncation);
  if (typeNode === undefined) return;
  const text = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, typeNode, call.getSourceFile());

  const key = keyArgument.text;
  (typesByKey.get(key) ?? typesByKey.set(key, new Set()).get(key)!).add(text);
  const captures = capturesByKey.get(key) ?? capturesByKey.set(key, new Set()).get(key)!;
  collectTypeReferenceNames(typeNode, captures);
}

/** Explicit `context.set<T>(...)` wins; otherwise the value argument's type, unwrapping one factory call and/or one Promise. */
function resolveSetValueType(context: CompilerContext, call: ts.CallExpression): ts.Type | undefined {
  const checker = context.typeChecker;
  if (call.typeArguments !== undefined && call.typeArguments.length > 0) return checker.getTypeFromTypeNode(call.typeArguments[0]!);
  const valueArgument = call.arguments[1];
  if (valueArgument === undefined) return undefined;
  const argumentType = checker.getTypeAtLocation(valueArgument);
  const callSignatures = argumentType.getCallSignatures();
  if (callSignatures.length === 0) return argumentType;
  return unwrapPromise(checker, checker.getReturnTypeOfSignature(callSignatures[0]!));
}

function unwrapPromise(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol?.getName() !== "Promise") return type;
  const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
  return typeArguments[0] ?? type;
}

/** Recursively collects every named-type identifier a printed type node references, so the generator can import them. */
function collectTypeReferenceNames(node: ts.Node, captures: Set<string>): void {
  if (ts.isTypeReferenceNode(node)) captures.add(rightmostName(node.typeName));
  if (ts.isImportTypeNode(node) && node.qualifier !== undefined) captures.add(rightmostName(node.qualifier));
  ts.forEachChild(node, (child) => collectTypeReferenceNames(child, captures));
}
function rightmostName(name: ts.EntityName): string { return ts.isIdentifier(name) ? name.text : name.right.text; }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isImport(value: BindingImport | undefined): value is BindingImport { return value !== undefined; }
