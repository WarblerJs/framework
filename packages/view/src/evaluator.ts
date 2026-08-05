import {
  TemplateExpressionError,
} from "./errors";
import type { ViewData, ViewDataValue } from "./types";

type ExpressionEvaluator = (...args: readonly ViewDataValue[]) => unknown;
const evaluatorCache = new Map<string, Readonly<{ keys: readonly string[]; evaluate: ExpressionEvaluator }>>();
const UNSAFE_ACCESS = /(?:^|[^A-Za-z0-9_$])(?:__proto__|prototype|constructor)(?:[^A-Za-z0-9_$]|$)/u;

const expressionFailureDetail = (error: unknown): string => {
  if (error instanceof ReferenceError) {
    const match = /^([^ ]+) is not defined$/u.exec(error.message);

    return match?.[1] === undefined
      ? error.message
      : `Variable "${match[1]}" is not defined.`;
  }

  return error instanceof Error ? error.message : String(error);
};

/** Evaluates one template expression against explicit render data. */
export const evaluateExpression = (
  expression: string,
  data: ViewData,
  viewName: string,
): unknown => {
  if (UNSAFE_ACCESS.test(expression)) {
    throw new TemplateExpressionError(
      viewName,
      expression,
      "Prototype-property access is not allowed.",
      Object.freeze(Object.keys(data).sort()),
    );
  }
  const keys = Object.keys(data);

  try {
    const signature = `${keys.join("\u0000")}\u0001${expression}`;
    let compiled = evaluatorCache.get(signature);
    if (compiled === undefined) {
      // Audited legacy compatibility boundary: expressions are compiled once, never from a request
      // filesystem read, and receive only explicitly named render values.
      const evaluate = new Function(
        ...keys,
        `"use strict"; return (${expression});`,
      ) as ExpressionEvaluator;
      compiled = Object.freeze({ keys: Object.freeze(keys), evaluate });
      evaluatorCache.set(signature, compiled);
    }
    return compiled.evaluate(...compiled.keys.map((key) => data[key]));
  } catch (error) {
    throw new TemplateExpressionError(
      viewName,
      expression,
      expressionFailureDetail(error),
      Object.freeze([...keys].sort((left, right) => left.localeCompare(right, "en"))),
      error,
    );
  }
};
