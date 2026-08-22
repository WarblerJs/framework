import ts from "typescript";

export type SourceChangeKind = "code" | "metadata" | "graph";

/** Builds a conservative signature for source facts consumed by the Warbler pipeline. */
export function sourceMetadataSignature(source: ts.SourceFile): string {
  const facts: string[] = [];
  const add = (kind: string, node: ts.Node, value: string): void => {
    const point = source.getLineAndCharacterOfPosition(node.getStart(source));
    facts.push(`${kind}:${point.line + 1}:${point.character + 1}:${value}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add("module", node, compactText(node));
      return;
    }

    if (isTopLevelDeclaration(node)) add("declaration", node, declarationSignature(node));

    if (ts.isClassDeclaration(node)) {
      add("class", node, classSignature(node));
      for (const member of node.members) add("member", member, memberSignature(member));
    }

    if (ts.isCallExpression(node)) {
      const fact = compilerRelevantCallFact(node);
      if (fact !== undefined) add("call", node, fact);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return JSON.stringify(facts);
}

function isTopLevelDeclaration(node: ts.Node): node is ts.ClassDeclaration | ts.FunctionDeclaration | ts.VariableStatement | ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  return ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node);
}

function declarationSignature(node: ts.ClassDeclaration | ts.FunctionDeclaration | ts.VariableStatement | ts.InterfaceDeclaration | ts.TypeAliasDeclaration): string {
  if (ts.isVariableStatement(node)) {
    return JSON.stringify({
      modifiers: modifierSignature(node),
      declarations: node.declarationList.declarations.map((declaration) => ts.isIdentifier(declaration.name) ? declaration.name.text : declaration.name.getText()),
    });
  }
  return JSON.stringify({
    name: node.name?.text ?? "",
    modifiers: modifierSignature(node),
  });
}

function classSignature(node: ts.ClassDeclaration): string {
  return JSON.stringify({
    name: node.name?.text ?? "",
    modifiers: modifierSignature(node),
    decorators: decoratorSignature(node),
  });
}

function memberSignature(node: ts.ClassElement): string {
  return JSON.stringify({
    name: node.name?.getText() ?? "",
    kind: ts.SyntaxKind[node.kind],
    modifiers: modifierSignature(node),
    decorators: decoratorSignature(node),
    parameters: parameterCount(node),
  });
}

function parameterCount(node: ts.ClassElement): number {
  if (
    ts.isConstructorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) return node.parameters.length;
  return 0;
}

function compilerRelevantCallFact(node: ts.CallExpression): string | undefined {
  const expression = node.expression;
  const name = callName(expression);
  if (
    name === "createApp" ||
    name === "defineHttpGraph" ||
    name === "defineWebSocketGraph" ||
    name === "defineHandler" ||
    name === "defineValidator" ||
    name === "event" ||
    name === "listen" ||
    name === "interceptEvent"
  ) return `${name}:${node.arguments.map((argument) => argument.getText()).join(",")}`;
  if (name === "inject") return `inject:${argumentText(node, 0)}`;
  if (name === "view" || name === "csrf") return `${name}:${argumentText(node, 0)}`;
  if (name === "context.set" || name.endsWith(".set")) return `context-set:${argumentText(node, 0)}:${argumentText(node, 1)}`;
  if (name.endsWith(".dispatch") || name.endsWith(".dispatchAndWait")) return `event-dispatch:${argumentText(node, 0)}`;
  return undefined;
}

function callName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${callName(node.expression)}.${node.name.text}`;
  return node.getText();
}

function argumentText(node: ts.CallExpression, index: number): string {
  return node.arguments[index]?.getText() ?? "";
}

function decoratorSignature(node: ts.Node): readonly string[] {
  return ts.canHaveDecorators(node)
    ? (ts.getDecorators(node) ?? []).map(compactText)
    : [];
}

function modifierSignature(node: ts.Node): readonly string[] {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).map((modifier) => ts.SyntaxKind[modifier.kind])
    : [];
}

function compactText(node: ts.Node): string {
  return node.getText().replace(/\s+/gu, " ");
}
