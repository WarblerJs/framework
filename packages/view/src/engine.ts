import { resolveLayout } from "./layout";
import { compileRenderer } from "./renderer";
import {
  TemplateCompilationError,
  ViewError,
  ViewNotFoundException,
} from "./errors";
import type {
  AstNode,
  TemplateAst,
} from "./ast";
import type {
  CompiledTemplate,
  CompiledViewArtifact,
  RenderCompiledViewOptions,
  ViewBuiltins,
  ViewData,
  ViewDataValue,
} from "./types";

const defaultLayoutContentNode = (content: string): AstNode =>
  Object.freeze({
    kind: "text",
    value: content,
  });

const injectDefaultLayoutContent = (
  nodes: readonly AstNode[],
  content: string,
): readonly AstNode[] => {
  const output: AstNode[] = [];
  const contentNode = defaultLayoutContentNode(content);

  for (const node of nodes) {
    if (node.kind === "expression" && node.expression.trim() === "content") {
      output.push(contentNode);
      continue;
    }

    if (node.kind === "yield" && node.name === "content") {
      output.push(contentNode);
      continue;
    }

    if (node.kind === "if") {
      output.push({
        ...node,
        branches: Object.freeze(node.branches.map((branch) => ({
          ...branch,
          body: injectDefaultLayoutContent(branch.body, content),
        }))),
      });
      continue;
    }

    if (node.kind === "for") {
      output.push({
        ...node,
        body: injectDefaultLayoutContent(node.body, content),
      });
      continue;
    }

    if (node.kind === "switch") {
      output.push({
        ...node,
        cases: Object.freeze(node.cases.map((caseNode) => ({
          ...caseNode,
          body: injectDefaultLayoutContent(caseNode.body, content),
        }))),
      });
      continue;
    }

    output.push(node);
  }

  return Object.freeze(output);
};

const astWithDefaultLayoutContent = (
  ast: TemplateAst,
  content: string,
): TemplateAst =>
  Object.freeze({
    ...ast,
    body: injectDefaultLayoutContent(ast.body, content),
  });

export class CompiledViewEngine {
  private readonly rendererCache =
    new Map<string, CompiledTemplate>();

  public constructor(
    private readonly artifact: CompiledViewArtifact,
    private readonly translate?: (key: string) => string,
  ) {}

  public render(
    name: string,
    data: ViewData = Object.freeze({}),
    builtins?: ViewBuiltins,
  ): string {
    return this.renderView(name, data, true, builtins);
  }

  private renderView(
    name: string,
    data: ViewData,
    applyDefaultLayout: boolean,
    builtins?: ViewBuiltins,
  ): string {
    const ast = this.loadAst(name);
    const renderer = this.getRenderer(name);
    const html = renderer(data, builtins);

    if (
      !applyDefaultLayout ||
      this.artifact.defaultLayout === undefined ||
      ast.extendsName !== undefined ||
      name === this.artifact.defaultLayout
    ) {
      return html;
    }

    return this.renderDefaultLayout(html, data, builtins);
  }

  private rendererContext = (
    name: string,
  ) => Object.freeze({
    viewName: name,
    renderTemplate: (partial: string, partialData: ViewData, partialBuiltins?: ViewBuiltins) =>
      this.renderView(partial, partialData, false, partialBuiltins),
    ...(this.translate === undefined
      ? {}
      : { translate: this.translate }),
  });

  private sourceFor(name: string): string {
    const source = this.artifact.templates[name];

    if (source === undefined) {
      throw new ViewNotFoundException(
        name,
        Object.freeze(Object.keys(this.artifact.templates)),
      );
    }

    return source;
  }

  private loadAst = (
    name: string,
  ): (typeof this.artifact.ast)[string] => {
    const ast = this.artifact.ast[name];
    if (ast !== undefined) return ast;
    this.sourceFor(name);
    throw new ViewNotFoundException(name);
  };

  private getRenderer(
    name: string,
  ): CompiledTemplate {
    const cached = this.rendererCache.get(name);

    if (cached !== undefined && this.artifact.cache) {
      return cached;
    }

    let resolved: ReturnType<typeof resolveLayout>;

    try {
      resolved = resolveLayout(name, this.loadAst);
    } catch (error) {
      if (error instanceof ViewError) {
        throw error;
      }

      throw new TemplateCompilationError(
        name,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }

    const renderer = compileRenderer(resolved, this.rendererContext(name));

    if (this.artifact.cache) {
      this.rendererCache.set(name, renderer);
    }

    return renderer;
  }

  private renderDefaultLayout(
    content: string,
    data: ViewData,
    builtins?: ViewBuiltins,
  ): string {
    const layoutName = this.artifact.defaultLayout;

    if (layoutName === undefined) {
      return content;
    }

    const ast = astWithDefaultLayoutContent(
      this.loadAst(layoutName),
      content,
    );
    const renderer = compileRenderer(ast, this.rendererContext(layoutName));

    return renderer(Object.freeze({
      ...data,
      content,
    } as Record<string, ViewDataValue>), builtins);
  }
}

export const renderCompiledView = (
  options: RenderCompiledViewOptions,
): string => {
  const engine = new CompiledViewEngine(
    options.artifact,
    options.translate,
  );

  const data = options.data === undefined
    ? Object.freeze({})
    : options.data;

  return engine.render(options.name, data, options.builtins);
};

export { ViewNotFoundException } from "./errors";
