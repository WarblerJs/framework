export type AstNode =
  | TextNode
  | ExpressionNode
  | IfNode
  | ForNode
  | SwitchNode
  | ImportNode
  | YieldNode;

export interface TextNode {
  readonly kind: "text";
  readonly value: string;
}

export interface ExpressionNode {
  readonly kind: "expression";
  readonly expression: string;
  readonly raw: boolean;
  /** Character offset of the expression's first character in its template source. */
  readonly offset: number;
}

export interface IfBranch {
  readonly condition: string | null;
  readonly body: readonly AstNode[];
}

export interface IfNode {
  readonly kind: "if";
  readonly branches: readonly IfBranch[];
}

export interface ForNode {
  readonly kind: "for";
  readonly itemName: string;
  readonly indexName?: string;
  readonly iterable: string;
  readonly body: readonly AstNode[];
}

export interface SwitchCase {
  readonly expression: string | null;
  readonly body: readonly AstNode[];
}

export interface SwitchNode {
  readonly kind: "switch";
  readonly expression: string;
  readonly cases: readonly SwitchCase[];
}

export interface ImportNode {
  readonly kind: "import";
  readonly name: string;
}

export interface YieldNode {
  readonly kind: "yield";
  readonly name: string;
  readonly fallback?: string;
}

export interface TemplateAst {
  readonly extendsName?: string;
  readonly sections: Readonly<Record<string, readonly AstNode[]>>;
  readonly body: readonly AstNode[];
}
