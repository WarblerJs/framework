import { PgDefault } from "../columns/pg-default";
import type { CheckConstraintMetadata, ForeignKeyMetadata, RawSqlDefault } from "../types/model.types";
import { quoteIdentifier, quoteLiteral } from "../utils/sql-identifier";

const RAW_DEFAULT_EXPRESSIONS = new Set<string>(Object.values(PgDefault));

/** The minimal shape needed to render one column definition line, satisfied by both introspected `ColumnMetadata` and a migration's `NormalizedColumn` + its `ColumnBuilder`. Optional fields explicitly allow `undefined` (not just absence) since callers forward optional `ColumnBuilder` fields directly. */
export interface ColumnDefinitionInput {
  readonly columnName: string;
  readonly sqlType: string;
  readonly nullable?: boolean | undefined;
  readonly default?: string | number | boolean | RawSqlDefault | undefined;
  readonly identity?: boolean | undefined;
}

function isRawSqlDefault(value: string | number | boolean | RawSqlDefault): value is RawSqlDefault {
  return typeof value === "object" && value !== null && "raw" in value;
}

/** Renders a DEFAULT value: `{ raw }` and `PgDefault.*` values are raw SQL expressions, everything else is a quoted literal. */
export function renderDefault(value: string | number | boolean | RawSqlDefault): string {
  if (isRawSqlDefault(value)) return value.raw;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return RAW_DEFAULT_EXPRESSIONS.has(value) ? value : quoteLiteral(value);
}

/** Renders one column definition, e.g. `"email" VARCHAR(255) NOT NULL DEFAULT 'x'` (no leading indentation). Columns are NOT NULL unless `nullable` is explicitly `true`. */
export function renderColumnDefinition(column: ColumnDefinitionInput): string {
  const parts = [`${quoteIdentifier(column.columnName)} ${column.sqlType}`];
  if (column.nullable !== true) parts.push("NOT NULL");
  if (column.default !== undefined) parts.push(`DEFAULT ${renderDefault(column.default)}`);
  if (column.identity === true) parts.push("GENERATED ALWAYS AS IDENTITY");
  return parts.join(" ");
}

/** Renders a table-level `CONSTRAINT ... CHECK (...)` fragment. */
export function renderCheckConstraint(tableName: string, check: CheckConstraintMetadata): string {
  return `CONSTRAINT ${quoteIdentifier(`${tableName}_${check.column}_check`)} CHECK (${check.expression})`;
}

/** Renders a table-level `CONSTRAINT ... FOREIGN KEY ... REFERENCES ...` fragment. */
export function renderForeignKeyConstraint(tableName: string, foreignKey: ForeignKeyMetadata): string {
  const constraint = [
    `CONSTRAINT ${quoteIdentifier(`${tableName}_${foreignKey.column}_fkey`)}`,
    `FOREIGN KEY (${quoteIdentifier(foreignKey.column)})`,
    `REFERENCES ${quoteIdentifier(foreignKey.referencesTable)} (${quoteIdentifier(foreignKey.referencesColumn)})`,
  ];
  if (foreignKey.onDelete !== undefined) constraint.push(`ON DELETE ${foreignKey.onDelete}`);
  if (foreignKey.onUpdate !== undefined) constraint.push(`ON UPDATE ${foreignKey.onUpdate}`);
  return constraint.join(" ");
}

/** Renders `CREATE TYPE "name" AS ENUM (...)`. */
export function renderCreateEnumStatement(name: string, values: readonly string[]): string {
  return `CREATE TYPE ${quoteIdentifier(name)} AS ENUM (${values.map(quoteLiteral).join(", ")});`;
}

/** Renders `DROP TYPE [IF EXISTS] "name"`. */
export function renderDropEnumStatement(name: string, ifExists: boolean): string {
  return `DROP TYPE ${ifExists ? "IF EXISTS " : ""}${quoteIdentifier(name)};`;
}

/** Renders `CREATE [UNIQUE] INDEX "name" ON "table" (...)`. */
export function renderCreateIndexStatement(
  tableName: string,
  indexName: string,
  columns: readonly string[],
  unique: boolean,
): string {
  const kind = unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
  return `${kind} ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")});`;
}

/** Renders `DROP INDEX [IF EXISTS] "name"`. */
export function renderDropIndexStatement(indexName: string, ifExists: boolean): string {
  return `DROP INDEX ${ifExists ? "IF EXISTS " : ""}${quoteIdentifier(indexName)};`;
}
