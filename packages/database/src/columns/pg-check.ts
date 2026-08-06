import { quoteIdentifier, quoteLiteral } from "../utils/sql-identifier";
import type { ColumnCheckExpression } from "../types/column.types";

type CheckLiteral = string | number | boolean;

const literal = (value: CheckLiteral): string =>
  typeof value === "string" ? quoteLiteral(value) : String(value);

const check = (render: (column: string) => string): ColumnCheckExpression =>
  Object.freeze({ __wlbCheck: true, render });

/** Lazily-rendered CHECK constraint expressions, resolved against their owning column at schema-generation time. */
export const PgCheck = Object.freeze({
  gt: (value: number): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} > ${literal(value)}`),
  gte: (value: number): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} >= ${literal(value)}`),
  lt: (value: number): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} < ${literal(value)}`),
  lte: (value: number): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} <= ${literal(value)}`),
  eq: (value: CheckLiteral): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} = ${literal(value)}`),
  ne: (value: CheckLiteral): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} <> ${literal(value)}`),
  between: (min: number, max: number): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} BETWEEN ${literal(min)} AND ${literal(max)}`),
  oneOf: (values: readonly CheckLiteral[]): ColumnCheckExpression =>
    check((column) => `${quoteIdentifier(column)} IN (${values.map(literal).join(", ")})`),
  raw: (expression: string): ColumnCheckExpression => check(() => expression),
});
