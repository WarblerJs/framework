import type { AstNode, TemplateAst } from "./ast";

export type TemplateLoader = (name: string) => TemplateAst;

const replaceYields = (
  nodes: readonly AstNode[],
  sections: Readonly<Record<string, readonly AstNode[]>>,
): readonly AstNode[] => {
  const output: AstNode[] = [];

  for (const node of nodes) {
    if (node.kind === "yield") {
      const section = sections[node.name];

      if (section !== undefined) {
        output.push(...section);
      } else if (node.fallback !== undefined) {
        output.push({
          kind: "text",
          value: node.fallback,
        });
      }

      continue;
    }

    if (node.kind === "if") {
      output.push({
        ...node,
        branches: Object.freeze(
          node.branches.map((branch) => ({
            ...branch,
            body: replaceYields(branch.body, sections),
          })),
        ),
      });
      continue;
    }

    if (node.kind === "for") {
      output.push({
        ...node,
        body: replaceYields(node.body, sections),
      });
      continue;
    }

    if (node.kind === "switch") {
      output.push({
        ...node,
        cases: Object.freeze(
          node.cases.map((caseNode) => ({
            ...caseNode,
            body: replaceYields(caseNode.body, sections),
          })),
        ),
      });
      continue;
    }

    output.push(node);
  }

  return Object.freeze(output);
};

export const resolveLayout = (
  name: string,
  load: TemplateLoader,
  inheritedSections: Readonly<
    Record<string, readonly AstNode[]>
  > = Object.freeze({}),
  visited: ReadonlySet<string> = new Set(),
): TemplateAst => {
  if (visited.has(name)) {
    throw new Error(`Circular view layout detected: ${name}`);
  }
 
  const nextVisited = new Set(visited);
  nextVisited.add(name);

  const current = load(name);
  const sections = Object.freeze({
    ...current.sections,
    ...inheritedSections,
  });

  if (current.extendsName === undefined) {
    return {
      sections: Object.freeze({}),
      body: replaceYields(current.body, sections),
    };
  }

  return resolveLayout(
    current.extendsName,
    load,
    sections,
    nextVisited,
  );
};
