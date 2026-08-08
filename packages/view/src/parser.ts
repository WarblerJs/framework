import type {
  AstNode,
  ForNode,
  IfBranch,
  SwitchCase,
  TemplateAst,
} from "./ast";
import { Scanner, TemplateSyntaxError } from "./scanner";

const unquote = (value: string): string => {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);

  if (
    (first === "'" && last === "'") ||
    (first === '"' && last === '"')
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const parseCallStringArgs = (input: string): readonly string[] => {
  const output: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;

  for (const char of input) {
    if (quote !== null) {
      current += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      output.push(unquote(current));
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    output.push(unquote(current));
  }

  return output;
};

const parseForHeader = (header: string): Omit<ForNode, "kind" | "body"> => {
  const withoutTrack = header.split(";")[0]?.trim() ?? "";
  const match =
    /^(?:\(\s*)?([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?(?:\s*\))?\s+of\s+(.+)$/u.exec(
      withoutTrack,
    );

  if (!match) {
    throw new TemplateSyntaxError("Invalid @for expression", 0);
  }

  const itemName = match[1];
  const indexName = match[2];
  const iterable = match[3]?.trim();

  if (itemName === undefined || iterable === undefined) {
    throw new TemplateSyntaxError("Invalid @for expression", 0);
  }

  return {
    itemName,
    ...(indexName === undefined ? {} : { indexName }),
    iterable,
  };
};

class Parser {
  private readonly scanner: Scanner;
  private extendsName: string | undefined;
  private readonly sections: Record<string, readonly AstNode[]> = {};

  public constructor(source: string) {
    this.scanner = new Scanner(source);
  }

  public parse(): TemplateAst {
    const body = this.parseNodes();

    return {
      ...(this.extendsName === undefined
        ? {}
        : { extendsName: this.extendsName }),
      sections: Object.freeze({ ...this.sections }),
      body: Object.freeze(body),
    };
  }

  private parseNodes(stopOnCloseBrace = false): AstNode[] {
    const nodes: AstNode[] = [];

    while (!this.scanner.done) {
      if (stopOnCloseBrace && this.scanner.startsWith("}")) {
        this.scanner.advance();
        return nodes;
      }

      if (this.scanner.startsWith("{{{")) {
        this.scanner.advance(3);
        const offset = this.scanner.position;
        nodes.push({
          kind: "expression",
          expression: this.scanner.readUntil("}}}").trim(),
          raw: true,
          offset,
        });
        continue;
      }

      if (this.scanner.startsWith("{!!")) {
        this.scanner.advance(3);
        const offset = this.scanner.position;
        nodes.push({
          kind: "expression",
          expression: this.scanner.readUntil("!!}").trim(),
          raw: true,
          offset,
        });
        continue;
      }

      if (this.scanner.startsWith("{{")) {
        this.scanner.advance(2);
        const offset = this.scanner.position;
        nodes.push({
          kind: "expression",
          expression: this.scanner.readUntil("}}").trim(),
          raw: false,
          offset,
        });
        continue;
      }

      if (this.scanner.startsWith("@if")) {
        nodes.push(this.parseIf());
        continue;
      }

      if (this.scanner.startsWith("@for")) {
        nodes.push(this.parseFor());
        continue;
      }

      if (this.scanner.startsWith("@switch")) {
        nodes.push(this.parseSwitch());
        continue;
      }

      if (this.scanner.startsWith("@import")) {
        nodes.push(this.parseImport());
        continue;
      }

      if (this.scanner.startsWith("@yield")) {
        nodes.push(this.parseYield());
        continue;
      }

      if (this.scanner.startsWith("@extends")) {
        this.parseExtends();
        continue;
      }

      if (this.scanner.startsWith("@section")) {
        this.parseSection();
        continue;
      }

      const text = this.scanner.readTextUntil([
        (scanner) => scanner.startsWith("{{{"),
        (scanner) => scanner.startsWith("{!!"),
        (scanner) => scanner.startsWith("{{"),
        (scanner) => scanner.startsWith("@if"),
        (scanner) => scanner.startsWith("@for"),
        (scanner) => scanner.startsWith("@switch"),
        (scanner) => scanner.startsWith("@import"),
        (scanner) => scanner.startsWith("@yield"),
        (scanner) => scanner.startsWith("@extends"),
        (scanner) => scanner.startsWith("@section"),
        (scanner) => stopOnCloseBrace && scanner.startsWith("}"),
      ]);

      if (text.length > 0) {
        nodes.push({ kind: "text", value: text });
      }
    }

    if (stopOnCloseBrace) {
      throw new TemplateSyntaxError(
        "Expected closing brace",
        this.scanner.position,
      );
    }
    

    return nodes;
  }

  private readDirectiveArgs(name: string): string {
    this.scanner.advance(name.length);
    this.scanner.skipWhitespace();
    return this.scanner.readBalanced("(", ")").trim();
  }

  private parseBlock(): AstNode[] {
    this.scanner.skipWhitespace();

    if (!this.scanner.startsWith("{")) {
      throw new TemplateSyntaxError(
        "Expected opening brace",
        this.scanner.position,
      );
    }

    this.scanner.advance();
    return this.parseNodes(true);
  }

  private parseIf(): AstNode {
    const branches: IfBranch[] = [];
    const firstCondition = this.readDirectiveArgs("@if");
    branches.push({
      condition: firstCondition,
      body: Object.freeze(this.parseBlock()),
    });

    while (true) {
      this.scanner.skipWhitespace();

      if (!this.scanner.startsWith("@else")) {
        break;
      }

      this.scanner.advance("@else".length);
      this.scanner.skipWhitespace();

      if (this.scanner.startsWith("if")) {
        this.scanner.advance(2);
        this.scanner.skipWhitespace();

        branches.push({
          condition: this.scanner.readBalanced("(", ")").trim(),
          body: Object.freeze(this.parseBlock()),
        });
      } else {
        branches.push({
          condition: null,
          body: Object.freeze(this.parseBlock()),
        });
        break;
      }
    }

    return {
      kind: "if",
      branches: Object.freeze(branches),
    };
  }

  private parseFor(): AstNode {
    const header = this.readDirectiveArgs("@for");
    const parsed = parseForHeader(header);

    return {
      kind: "for",
      ...parsed,
      body: Object.freeze(this.parseBlock()),
    };
  }

  private parseSwitch(): AstNode {
    const expression = this.readDirectiveArgs("@switch");
    this.scanner.skipWhitespace();

    if (!this.scanner.startsWith("{")) {
      throw new TemplateSyntaxError(
        "Expected opening brace",
        this.scanner.position,
      );
    }

    this.scanner.advance();
    const cases: SwitchCase[] = [];

    while (!this.scanner.done) {
      this.scanner.skipWhitespace();

      if (this.scanner.startsWith("}")) {
        this.scanner.advance();
        break;
      }

      if (this.scanner.startsWith("@case")) {
        const caseExpression = this.readDirectiveArgs("@case");
        cases.push({
          expression: caseExpression,
          body: Object.freeze(this.parseBlock()),
        });
        continue;
      }

      if (this.scanner.startsWith("@default")) {
        this.scanner.advance("@default".length);
        cases.push({
          expression: null,
          body: Object.freeze(this.parseBlock()),
        });
        continue;
      }

      throw new TemplateSyntaxError(
        "Expected @case, @default or closing brace",
        this.scanner.position,
      );
    }

    return {
      kind: "switch",
      expression,
      cases: Object.freeze(cases),
    };
  }

  private parseImport(): AstNode {
    const args = parseCallStringArgs(this.readDirectiveArgs("@import"));
    const name = args[0];

    if (name === undefined) {
      throw new TemplateSyntaxError(
        "@import requires a template name",
        this.scanner.position,
      );
    }

    return { kind: "import", name };
  }

  private parseYield(): AstNode {
    const args = parseCallStringArgs(this.readDirectiveArgs("@yield"));
    const name = args[0];

    if (name === undefined) {
      throw new TemplateSyntaxError(
        "@yield requires a section name",
        this.scanner.position,
      );
    }

    const fallback = args[1];

    return {
      kind: "yield",
      name,
      ...(fallback === undefined ? {} : { fallback }),
    };
  }

  private parseExtends(): void {
    const args = parseCallStringArgs(this.readDirectiveArgs("@extends"));
    const name = args[0];

    if (name === undefined) {
      throw new TemplateSyntaxError(
        "@extends requires a layout name",
        this.scanner.position,
      );
    }

    this.extendsName = name;
  }

  private parseSection(): void {
    const args = parseCallStringArgs(this.readDirectiveArgs("@section"));
    const name = args[0];

    if (name === undefined) {
      throw new TemplateSyntaxError(
        "@section requires a section name",
        this.scanner.position,
      );
    }

    this.sections[name] = Object.freeze(this.parseBlock());
  }
}

export const parseTemplate = (source: string): TemplateAst =>
  new Parser(source).parse();
