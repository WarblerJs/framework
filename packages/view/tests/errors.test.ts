import { describe, expect, test } from "bun:test";
import {
  assertNoReservedViewData,
  createCompiledViewArtifact,
  evaluateExpression,
  offsetToLineColumn,
  parseTemplate,
  renderCompiledView,
  TemplateExpressionError,
  ViewError,
  ViewReservedVariableError,
} from "../src";

describe("ViewReservedVariableError / assertNoReservedViewData", () => {
  test("throws for the first colliding reserved key with a clear message and code", () => {
    let caught: unknown;
    try {
      assertNoReservedViewData({ title: "x", csrfField: "hijacked" }, ["tr", "asset", "route", "csrfField", "csrfToken"]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ViewReservedVariableError);
    const error = caught as ViewReservedVariableError;
    expect(error.code).toBe("VIEW1004");
    expect(error.variableName).toBe("csrfField");
    expect(error.message).toBe('Variable "csrfField" is reserved by Warbler.');
  });

  test("does not throw when data has no reserved keys", () => {
    expect(() => assertNoReservedViewData({ title: "x" }, ["tr", "csrfField"])).not.toThrow();
  });
});

describe("expression source offsets", () => {
  test("parser records the character offset of each expression", () => {
    const ast = parseTemplate("<h1>{{ name }}</h1>");
    const expressionNode = ast.body.find((node) => node.kind === "expression");
    expect(expressionNode?.kind).toBe("expression");
    expect(expressionNode && "offset" in expressionNode ? expressionNode.offset : undefined).toBe(6);
  });

  test("offsetToLineColumn converts an offset to a 1-indexed line/column", () => {
    const source = "line one\nline two\n  {{ bad }}";
    const offset = source.indexOf("{{ bad }}") + 3;
    expect(offsetToLineColumn(source, offset)).toEqual({ line: 3, column: 6 });
  });

  test("TemplateExpressionError carries the offset through to the caught error", () => {
    const artifact = createCompiledViewArtifact({
      templates: { home: "<h1>\n  {{ unknownHelper() }}</h1>" },
    });

    let caught: unknown;
    try {
      renderCompiledView({ artifact, name: "home" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TemplateExpressionError);
    const error = caught as TemplateExpressionError;
    expect(error.offset).toBeDefined();
    expect(offsetToLineColumn("<h1>\n  {{ unknownHelper() }}</h1>", error.offset!)).toEqual({ line: 2, column: 5 });
  });
});

describe("evaluateExpression rethrows known ViewErrors as-is", () => {
  test("a ViewError thrown from a builtin call is not flattened into TemplateExpressionError", () => {
    class CustomHelperError extends ViewError {
      public constructor() {
        super("custom helper failure", "VIEW9999");
      }
    }
    const helper = (): never => {
      throw new CustomHelperError();
    };

    expect(() => evaluateExpression("helper()", {}, "home", { helper })).toThrow(CustomHelperError);
  });

  test("a plain JS error is still normalized into TemplateExpressionError", () => {
    expect(() => evaluateExpression("unknownVariable", {}, "home")).toThrow(TemplateExpressionError);
  });
});
