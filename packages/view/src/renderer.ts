import type { AstNode, TemplateAst } from "./ast";
import { evaluateExpression } from "./evaluator";
import type {
  CompiledTemplate,
  RendererContext,
  ViewData,
  ViewDataValue,
} from "./types";

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const toIterable = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value !== null &&
    value !== undefined &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      "function"
  ) {
    return Array.from(value as Iterable<unknown>);
  }

  return [];
};

const translationKey = (expression: string): string | undefined => {
  const trimmed = expression.trim();

  return trimmed.startsWith("t:")
    ? trimmed.slice("t:".length).trim()
    : undefined;
};

const renderNodes = (
  nodes: readonly AstNode[],
  data: ViewData,
  context: RendererContext,
): string => {
  const output: string[] = [];
 
  for (const node of nodes) {
    switch (node.kind) {
      case "text": {
        output.push(node.value);
        break;
      }

      case "expression": {
        const key = translationKey(node.expression);
        const value = key === undefined
          ? evaluateExpression(node.expression, data, context.viewName)
          : context.translate?.(key) ?? key;

        output.push(node.raw ? String(value ?? "") : escapeHtml(value));
        break;
      }

      case "if": {
        for (const branch of node.branches) {
          if (
            branch.condition === null ||
            Boolean(evaluateExpression(branch.condition, data, context.viewName))
          ) {
            output.push(renderNodes(branch.body, data, context));
            break;
          }
        }

        break;
      }

      case "for": {
        const items = toIterable(
          evaluateExpression(node.iterable, data, context.viewName),
        );

        for (let index = 0; index < items.length; index += 1) {
          const childData: Record<string, ViewDataValue> = {
            ...data,
            [node.itemName]: items[index] as ViewDataValue,
          };

          if (node.indexName !== undefined) {
            childData[node.indexName] = index;
          }

          output.push(
            renderNodes(
              node.body,
              Object.freeze(childData),
              context,
            ),
          );
        }

        break;
      }

      case "switch": {
        const switchValue = evaluateExpression(node.expression, data, context.viewName);
        let defaultCase: (typeof node.cases)[number] | undefined;

        for (const caseNode of node.cases) {
          if (caseNode.expression === null) {
            defaultCase = caseNode;
            continue;
          }

          if (
            Object.is(
              switchValue,
              evaluateExpression(caseNode.expression, data, context.viewName),
            )
          ) {
            output.push(
              renderNodes(caseNode.body, data, context),
            );
            defaultCase = undefined;
            break;
          }
        }

        if (defaultCase !== undefined) {
          output.push(
            renderNodes(defaultCase.body, data, context),
          );
        }

        break;
      }

      case "import": {
        output.push(context.renderTemplate(node.name, data));
        break;
      }

      case "yield": {
        output.push(node.fallback ?? "");
        break;
      }
    }
  }

  return output.join("");
};

export const compileRenderer = (
  ast: TemplateAst,
  context: RendererContext,
): CompiledTemplate =>
  (data: ViewData = Object.freeze({})) =>
    renderNodes(ast.body, data, context);
