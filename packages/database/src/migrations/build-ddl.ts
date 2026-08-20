import { resolveColumns } from "../columns/resolve-columns";
import { DatabaseCompileError } from "../errors";
import { deriveColumnName } from "../naming";
import {
  renderCheckConstraint,
  renderColumnDefinition,
  renderCreateEnumStatement,
  renderCreateIndexStatement,
  renderDefault,
  renderDropEnumStatement,
  renderDropIndexStatement,
  renderForeignKeyConstraint,
} from "../schema/ddl-fragments";
import type { ColumnValue } from "../types/column.types";
import type { CheckConstraintMetadata, ForeignKeyMetadata, IndexPredicateMetadata, NormalizedColumn } from "../types/model.types";
import { quoteIdentifier, quoteLiteral } from "../utils/sql-identifier";
import type {
  AlterColumnChanges,
  AlterEnumChanges,
  CreateIndexOptions,
  CreateTableOptions,
  DropOptions,
  DropTableOptions,
} from "./types";

const SOFT_DELETE_TABLE_COMMENT = "warbler:soft-delete";

interface ExtractedConstraints {
  readonly primaryKey: readonly string[];
  readonly checks: readonly CheckConstraintMetadata[];
  readonly foreignKeys: readonly ForeignKeyMetadata[];
}

function extractConstraints(columns: readonly NormalizedColumn[]): ExtractedConstraints {
  const primaryKey: string[] = [];
  const checks: CheckConstraintMetadata[] = [];
  const foreignKeys: ForeignKeyMetadata[] = [];
  for (const column of columns) {
    const builder = column.builder;
    if (builder.primaryKey === true) primaryKey.push(column.columnName);
    if (builder.check !== undefined) {
      checks.push(Object.freeze({ column: column.columnName, expression: builder.check.render(column.columnName) }));
    }
    if (builder.references !== undefined) {
      foreignKeys.push(Object.freeze({
        column: column.columnName,
        referencesTable: builder.references.table,
        referencesColumn: builder.references.column,
        ...(builder.onDelete === undefined ? {} : { onDelete: builder.onDelete }),
        ...(builder.onUpdate === undefined ? {} : { onUpdate: builder.onUpdate }),
      }));
    }
  }
  return Object.freeze({ primaryKey: Object.freeze(primaryKey), checks: Object.freeze(checks), foreignKeys: Object.freeze(foreignKeys) });
}

function indexAndCommentStatements(tableName: string, columns: readonly NormalizedColumn[]): readonly string[] {
  const statements: string[] = [];
  for (const column of columns) {
    const builder = column.builder;
    if (builder.unique === true) {
      statements.push(renderCreateIndexStatement(tableName, `${tableName}_${column.columnName}_key`, [column.columnName], true));
    } else if (builder.index === true) {
      statements.push(renderCreateIndexStatement(tableName, `${tableName}_${column.columnName}_idx`, [column.columnName], false));
    }
    if (builder.comment !== undefined) {
      statements.push(
        `COMMENT ON COLUMN ${quoteIdentifier(tableName)}.${quoteIdentifier(column.columnName)} IS ${quoteLiteral(builder.comment)};`,
      );
    }
  }
  return statements;
}

function validateSoftDeleteColumn(tableName: string, columns: readonly NormalizedColumn[]): string {
  const column = columns.find((candidate) => candidate.fieldName === "deletedAt" && candidate.columnName === "deleted_at");
  if (column === undefined) {
    throw new DatabaseCompileError(`createTable(${tableName})`, "`softDelete: true` requires a `deletedAt` column.");
  }
  if (column.builder.pgType !== "timestamp" && column.builder.pgType !== "timestamptz") {
    throw new DatabaseCompileError(`createTable(${tableName})`, "`deletedAt` must be a TIMESTAMP or TIMESTAMPTZ column.");
  }
  if (column.builder.nullable !== true) {
    throw new DatabaseCompileError(`createTable(${tableName})`, "`deletedAt` must be nullable.");
  }
  return column.columnName;
}

function tableCommentStatement(tableName: string, comment: string): string {
  return `COMMENT ON TABLE ${quoteIdentifier(tableName)} IS ${quoteLiteral(comment)};`;
}

function compileIndexWhere(table: string, where: CreateIndexOptions["where"]): readonly IndexPredicateMetadata[] {
  if (where === undefined) return Object.freeze([]);
  const predicates: IndexPredicateMetadata[] = [];
  for (const [field, value] of Object.entries(where)) {
    const column = deriveColumnName(field);
    if (value === null) {
      predicates.push(Object.freeze({ column, operator: "isNull" }));
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value) && "not" in value && value.not === null && Object.keys(value).length === 1) {
      predicates.push(Object.freeze({ column, operator: "isNotNull" }));
      continue;
    }
    throw new DatabaseCompileError(`createIndex(${table})`, "Index where predicates support only `{ field: null }` or `{ field: { not: null } }`.");
  }
  if (predicates.length === 0) throw new DatabaseCompileError(`createIndex(${table})`, "Index where predicate must contain at least one field.");
  return Object.freeze(predicates);
}

/** `createTable`: one `CREATE TABLE` (with inline PRIMARY KEY/CHECK/FOREIGN KEY constraints), then index/comment statements. */
export function buildCreateTableSql(
  name: string,
  columns: Readonly<Record<string, ColumnValue>>,
  options: CreateTableOptions = {},
): readonly string[] {
  const resolved = resolveColumns(`createTable(${name})`, columns);
  const { primaryKey, checks, foreignKeys } = extractConstraints(resolved);
  const lines = resolved.map((column) =>
    renderColumnDefinition({
      columnName: column.columnName,
      sqlType: column.builder.sqlType,
      nullable: column.builder.nullable,
      default: column.builder.default,
      identity: column.builder.identity,
    })
  );
  if (primaryKey.length > 0) lines.push(`PRIMARY KEY (${primaryKey.map(quoteIdentifier).join(", ")})`);
  for (const check of checks) lines.push(renderCheckConstraint(name, check));
  for (const foreignKey of foreignKeys) lines.push(renderForeignKeyConstraint(name, foreignKey));

  const ifNotExists = options.ifNotExists === true ? "IF NOT EXISTS " : "";
  const softDeleteStatements = options.softDelete === true
    ? [tableCommentStatement(name, SOFT_DELETE_TABLE_COMMENT)]
    : [];
  if (options.softDelete === true) validateSoftDeleteColumn(name, resolved);
  return Object.freeze([
    `CREATE TABLE ${ifNotExists}${quoteIdentifier(name)} (\n  ${lines.join(",\n  ")}\n);`,
    ...indexAndCommentStatements(name, resolved),
    ...softDeleteStatements,
  ]);
}

/** `dropTable`: one `DROP TABLE`. */
export function buildDropTableSql(name: string, options: DropTableOptions = {}): string {
  const ifExists = options.ifExists === true ? "IF EXISTS " : "";
  const cascade = options.cascade === true ? " CASCADE" : "";
  return `DROP TABLE ${ifExists}${quoteIdentifier(name)}${cascade};`;
}

/** `renameTable`. */
export function buildRenameTableSql(from: string, to: string): string {
  return `ALTER TABLE ${quoteIdentifier(from)} RENAME TO ${quoteIdentifier(to)};`;
}

/** `addColumns`: one `ALTER TABLE ... ADD COLUMN` per column, then constraint/index/comment statements. Adding a `primaryKey` column via `addColumns` is not supported — declare it in `createTable` instead. */
export function buildAddColumnsSql(table: string, columns: Readonly<Record<string, ColumnValue>>): readonly string[] {
  const resolved = resolveColumns(`addColumns(${table})`, columns);
  const { primaryKey, checks, foreignKeys } = extractConstraints(resolved);
  if (primaryKey.length > 0) {
    throw new DatabaseCompileError(`addColumns(${table})`, "primaryKey is not supported here — declare primary keys in createTable.");
  }
  const columnStatements = resolved.map((column) =>
    `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${renderColumnDefinition({
      columnName: column.columnName,
      sqlType: column.builder.sqlType,
      nullable: column.builder.nullable,
      default: column.builder.default,
      identity: column.builder.identity,
    })};`
  );
  const constraintStatements = [
    ...checks.map((check) => `ALTER TABLE ${quoteIdentifier(table)} ADD ${renderCheckConstraint(table, check)};`),
    ...foreignKeys.map((foreignKey) => `ALTER TABLE ${quoteIdentifier(table)} ADD ${renderForeignKeyConstraint(table, foreignKey)};`),
  ];
  return Object.freeze([...columnStatements, ...constraintStatements, ...indexAndCommentStatements(table, resolved)]);
}

/** `dropColumns`: one `ALTER TABLE ... DROP COLUMN` per column. */
export function buildDropColumnsSql(table: string, columns: readonly string[]): readonly string[] {
  if (columns.length === 0) throw new DatabaseCompileError(`dropColumns(${table})`, "At least one column is required.");
  return Object.freeze(columns.map((column) => `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(column)};`));
}

/** `renameColumn`. */
export function buildRenameColumnSql(table: string, from: string, to: string): string {
  return `ALTER TABLE ${quoteIdentifier(table)} RENAME COLUMN ${quoteIdentifier(from)} TO ${quoteIdentifier(to)};`;
}

/** `alterColumn`: one `ALTER TABLE` with comma-joined `ALTER COLUMN` clauses. */
export function buildAlterColumnSql(table: string, column: string, changes: AlterColumnChanges): string {
  const clauses: string[] = [];
  if (changes.type !== undefined) {
    clauses.push(`ALTER COLUMN ${quoteIdentifier(column)} TYPE ${changes.type.sqlType} USING ${quoteIdentifier(column)}::${changes.type.sqlType}`);
  }
  if (changes.nullable !== undefined) {
    clauses.push(`ALTER COLUMN ${quoteIdentifier(column)} ${changes.nullable ? "DROP NOT NULL" : "SET NOT NULL"}`);
  }
  if (changes.default !== undefined) {
    clauses.push(
      changes.default === null
        ? `ALTER COLUMN ${quoteIdentifier(column)} DROP DEFAULT`
        : `ALTER COLUMN ${quoteIdentifier(column)} SET DEFAULT ${renderDefault(changes.default)}`,
    );
  }
  if (clauses.length === 0) {
    throw new DatabaseCompileError(`alterColumn(${table}.${column})`, "At least one of type/nullable/default is required.");
  }
  return `ALTER TABLE ${quoteIdentifier(table)} ${clauses.join(", ")};`;
}

/** `createIndex`. */
export function buildCreateIndexSql(table: string, columns: readonly string[], options: CreateIndexOptions = {}): string {
  if (columns.length === 0) throw new DatabaseCompileError(`createIndex(${table})`, "At least one column is required.");
  const unique = options.unique === true;
  const indexName = options.name ?? `${table}_${columns.join("_")}_${unique ? "key" : "idx"}`;
  return renderCreateIndexStatement(table, indexName, columns, unique, compileIndexWhere(table, options.where));
}

/** `dropIndex`. */
export function buildDropIndexSql(name: string, options: DropOptions = {}): string {
  return renderDropIndexStatement(name, options.ifExists === true);
}

/** `createEnum`. */
export function buildCreateEnumSql(name: string, values: readonly string[]): string {
  if (values.length === 0) throw new DatabaseCompileError(`createEnum(${name})`, "At least one value is required.");
  return renderCreateEnumStatement(name, values);
}

/** `dropEnum`. */
export function buildDropEnumSql(name: string, options: DropOptions = {}): string {
  return renderDropEnumStatement(name, options.ifExists === true);
}

/** `alterEnum`: one `ALTER TYPE ... ADD VALUE` per new value. Postgres does not support adding multiple values atomically before version 12, and cannot run in the same transaction as a use of the new value on some versions — kept as separate statements so the caller controls ordering. */
export function buildAlterEnumSql(name: string, changes: AlterEnumChanges): readonly string[] {
  if (changes.addValues.length === 0) throw new DatabaseCompileError(`alterEnum(${name})`, "addValues requires at least one value.");
  return Object.freeze(changes.addValues.map((value) => `ALTER TYPE ${quoteIdentifier(name)} ADD VALUE ${quoteLiteral(value)};`));
}
