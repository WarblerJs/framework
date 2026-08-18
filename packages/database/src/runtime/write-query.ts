import type { SQL } from "bun";
import { DatabaseQueryError, DatabaseRecordNotFoundError } from "../errors";
import {
  assertUniqueSelector,
  columnByField,
  compileWhere,
  createCompileState,
  isPlainObject,
  param,
  q,
  rejectUndefined,
  type CompileState,
  type RuntimeColumn,
  type RuntimeModel,
  type RuntimeReadSchema,
} from "./read-query";

export interface MutationCountResult {
  readonly count: number;
}

export interface WriteQueryArgs {
  readonly data?: unknown;
  readonly where?: unknown;
  readonly create?: unknown;
  readonly update?: unknown;
  readonly select?: unknown;
}

const MAX_CREATE_MANY_ROWS = 1_000;
const NUMERIC_OPERATORS = new Set(["increment", "decrement", "multiply", "divide"]);

function writableColumns(model: RuntimeModel): readonly RuntimeColumn[] {
  return model.columns;
}

function isOperatorObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => key === "set" || NUMERIC_OPERATORS.has(key));
}

function validateColumnValue(model: RuntimeModel, column: RuntimeColumn, value: unknown, path: string): void {
  if (value === undefined) rejectUndefined(model, path);
  if (value === null && !column.nullable) throw new DatabaseQueryError(model.name, `Field "${path}" is not nullable.`);
}

function dataObject(model: RuntimeModel, value: unknown, label: string, allowEmpty: boolean): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw new DatabaseQueryError(model.name, `${label} must be an object.`);
  const keys = Object.keys(value);
  if (!allowEmpty && keys.length === 0) throw new DatabaseQueryError(model.name, `${label} must contain at least one field.`);
  for (const key of keys) {
    const column = columnByField(model, key);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown data field "${key}".`);
    validateColumnValue(model, column, value[key], key);
  }
  return value;
}

function returningSql(model: RuntimeModel, select: unknown): string {
  if (select === undefined) {
    return model.columns.map((column) => `${q(column.column)} AS ${q(column.field)}`).join(", ");
  }
  if (!isPlainObject(select)) throw new DatabaseQueryError(model.name, "`select` must be an object.");
  const parts: string[] = [];
  for (const [field, enabled] of Object.entries(select)) {
    if (enabled === undefined) rejectUndefined(model, `select.${field}`);
    if (enabled === false) continue;
    if (enabled !== true) throw new DatabaseQueryError(model.name, `Mutation select field "${field}" must be true or false.`);
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown select field "${field}".`);
    parts.push(`${q(column.column)} AS ${q(column.field)}`);
  }
  if (parts.length === 0) throw new DatabaseQueryError(model.name, "At least one field must be selected.");
  return parts.join(", ");
}

function insertColumns(model: RuntimeModel, data: Readonly<Record<string, unknown>>): readonly RuntimeColumn[] {
  const columns = Object.keys(data).map((field) => columnByField(model, field)!);
  return columns;
}

function compileInsertValues(schema: RuntimeReadSchema, model: RuntimeModel, data: Readonly<Record<string, unknown>>, state = createCompileState(schema)): { readonly columns: readonly RuntimeColumn[]; readonly valuesSql: string; readonly params: readonly unknown[] } {
  const columns = insertColumns(model, data);
  const values = columns.map((column) => param(state, data[column.field])).join(", ");
  return { columns, valuesSql: values, params: state.params };
}

function compileManyRows(schema: RuntimeReadSchema, model: RuntimeModel, rows: readonly Readonly<Record<string, unknown>>[]): { readonly columns: readonly RuntimeColumn[]; readonly valuesSql: string; readonly params: readonly unknown[] } {
  const state = createCompileState(schema);
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (!seen.has(field)) {
        const column = columnByField(model, field);
        if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown data field "${field}".`);
        seen.add(field);
        fields.push(field);
      }
    }
  }
  if (fields.length === 0) throw new DatabaseQueryError(model.name, "createMany requires at least one writable field when data is non-empty.");
  const columns = fields.map((field) => columnByField(model, field)!);
  const valuesSql = rows.map((row) => `(${columns.map((column) => {
    if (!(column.field in row)) return "DEFAULT";
    const value = row[column.field];
    validateColumnValue(model, column, value, column.field);
    return param(state, value);
  }).join(", ")})`).join(", ");
  return { columns, valuesSql, params: state.params };
}

function compileUpdateAssignments(model: RuntimeModel, data: Readonly<Record<string, unknown>>, state: CompileState): string {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown data field "${field}".`);
    if (!isOperatorObject(value)) {
      validateColumnValue(model, column, value, field);
      parts.push(`${q(column.column)} = ${param(state, value)}`);
      continue;
    }
    const operators = Object.entries(value);
    if (operators.length !== 1) throw new DatabaseQueryError(model.name, `Field "${field}" must use exactly one atomic operator.`);
    const [operator, operand] = operators[0]!;
    if (operand === undefined) rejectUndefined(model, `${field}.${operator}`);
    if (operator === "set") {
      validateColumnValue(model, column, operand, field);
      parts.push(`${q(column.column)} = ${param(state, operand)}`);
      continue;
    }
    if (column.kind !== "number" || !NUMERIC_OPERATORS.has(operator)) {
      throw new DatabaseQueryError(model.name, `Operator "${operator}" is not supported for field "${field}".`);
    }
    const sqlOperator = operator === "increment" ? "+" : operator === "decrement" ? "-" : operator === "multiply" ? "*" : "/";
    parts.push(`${q(column.column)} = ${q(column.column)} ${sqlOperator} ${param(state, operand)}`);
  }
  if (parts.length === 0) throw new DatabaseQueryError(model.name, "`data` must contain at least one field.");
  return parts.join(", ");
}

function whereUniqueSql(model: RuntimeModel, where: unknown, operation: string, state: CompileState): { readonly sql: string; readonly column: RuntimeColumn; readonly value: unknown } {
  const selector = assertUniqueSelector(model, where, operation);
  const field = Object.keys(selector)[0]!;
  const column = columnByField(model, field)!;
  const value = selector[field];
  return { sql: `${q(column.column)} = ${param(state, value)}`, column, value };
}

function whereManySql(model: RuntimeModel, where: unknown, operation: string, state: CompileState): string {
  if (!isPlainObject(where) || Object.keys(where).length === 0) {
    throw new DatabaseQueryError(model.name, `${operation} requires a non-empty \`where\`.`);
  }
  const predicate = compileWhere(state, model, "wq0", where, 0);
  if (predicate.length === 0) throw new DatabaseQueryError(model.name, `${operation} requires a non-empty \`where\`.`);
  return predicate;
}

async function oneOrThrow<Row>(model: RuntimeModel, operation: string, rows: readonly Row[]): Promise<Row> {
  const row = rows[0];
  if (row === undefined) throw new DatabaseRecordNotFoundError(model.name, operation);
  return row;
}

export async function executeCreate<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<Row> {
  const data = dataObject(model, args.data, "`data`", true);
  const returning = returningSql(model, args.select);
  if (Object.keys(data).length === 0) {
    const rows = await sql.unsafe<Row[]>(`INSERT INTO ${q(model.table)} DEFAULT VALUES RETURNING ${returning}`);
    return oneOrThrow(model, "create", rows);
  }
  const inserted = compileInsertValues(schema, model, data);
  const columnSql = inserted.columns.map((column) => q(column.column)).join(", ");
  const rows = await sql.unsafe<Row[]>(`INSERT INTO ${q(model.table)} (${columnSql}) VALUES (${inserted.valuesSql}) RETURNING ${returning}`, [...inserted.params]);
  return oneOrThrow(model, "create", rows);
}

export async function executeCreateMany(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs & { readonly skipDuplicates?: unknown }): Promise<MutationCountResult> {
  if (!Array.isArray(args.data)) throw new DatabaseQueryError(model.name, "createMany `data` must be an array.");
  if (args.data.length === 0) return Object.freeze({ count: 0 });
  if (args.data.length > MAX_CREATE_MANY_ROWS) throw new DatabaseQueryError(model.name, `createMany supports at most ${MAX_CREATE_MANY_ROWS} rows per call.`);
  const rows = args.data.map((row) => dataObject(model, row, "`data` row", false));
  const compiled = compileManyRows(schema, model, rows);
  const columnSql = compiled.columns.map((column) => q(column.column)).join(", ");
  const conflict = args.skipDuplicates === true ? " ON CONFLICT DO NOTHING" : "";
  const result = await sql.unsafe<{ count: number }[]>(
    `WITH inserted AS (INSERT INTO ${q(model.table)} (${columnSql}) VALUES ${compiled.valuesSql}${conflict} RETURNING 1) SELECT count(*)::int AS "count" FROM inserted`,
    [...compiled.params],
  );
  return Object.freeze({ count: result[0]?.count ?? 0 });
}

export async function executeCreateManyAndReturn<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs & { readonly skipDuplicates?: unknown }): Promise<Row[]> {
  if (!Array.isArray(args.data)) throw new DatabaseQueryError(model.name, "createManyAndReturn `data` must be an array.");
  if (args.data.length === 0) return [];
  if (args.data.length > MAX_CREATE_MANY_ROWS) throw new DatabaseQueryError(model.name, `createManyAndReturn supports at most ${MAX_CREATE_MANY_ROWS} rows per call.`);
  const rows = args.data.map((row) => dataObject(model, row, "`data` row", false));
  const compiled = compileManyRows(schema, model, rows);
  const columnSql = compiled.columns.map((column) => q(column.column)).join(", ");
  const conflict = args.skipDuplicates === true ? " ON CONFLICT DO NOTHING" : "";
  return sql.unsafe<Row[]>(`INSERT INTO ${q(model.table)} (${columnSql}) VALUES ${compiled.valuesSql}${conflict} RETURNING ${returningSql(model, args.select)}`, [...compiled.params]);
}

export async function executeUpdate<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<Row> {
  const data = dataObject(model, args.data, "`data`", false);
  const state = createCompileState(schema);
  const set = compileUpdateAssignments(model, data, state);
  const where = whereUniqueSql(model, args.where, "update", state);
  const rows = await sql.unsafe<Row[]>(
    `UPDATE ${q(model.table)} SET ${set} WHERE ${where.sql} RETURNING ${returningSql(model, args.select)}`,
    [...state.params],
  );
  return oneOrThrow(model, "update", rows);
}

export async function executeUpdateMany(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<MutationCountResult> {
  const data = dataObject(model, args.data, "`data`", false);
  const state = createCompileState(schema);
  const set = compileUpdateAssignments(model, data, state);
  const where = whereManySql(model, args.where, "updateMany", state);
  const rows = await sql.unsafe<{ count: number }[]>(
    `WITH updated AS (UPDATE ${q(model.table)} AS ${q("wq0")} SET ${set} WHERE ${where} RETURNING 1) SELECT count(*)::int AS "count" FROM updated`,
    [...state.params],
  );
  return Object.freeze({ count: rows[0]?.count ?? 0 });
}

export async function executeUpdateManyAndReturn<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<Row[]> {
  const data = dataObject(model, args.data, "`data`", false);
  const state = createCompileState(schema);
  const set = compileUpdateAssignments(model, data, state);
  const where = whereManySql(model, args.where, "updateManyAndReturn", state);
  return sql.unsafe<Row[]>(`UPDATE ${q(model.table)} AS ${q("wq0")} SET ${set} WHERE ${where} RETURNING ${returningSql(model, args.select)}`, [...state.params]);
}

export async function executeUpsert<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<Row> {
  const selector = assertUniqueSelector(model, args.where, "upsert");
  const field = Object.keys(selector)[0]!;
  const column = columnByField(model, field)!;
  const value = selector[field];
  const create = { ...dataObject(model, args.create, "`create`", false), [column.field]: value };
  const update = dataObject(model, args.update, "`update`", false);
  const state = createCompileState(schema);
  const inserted = compileInsertValues(schema, model, create, state);
  const set = compileUpdateAssignments(model, update, state);
  const columnSql = inserted.columns.map((column) => q(column.column)).join(", ");
  const rows = await sql.unsafe<Row[]>(
    `INSERT INTO ${q(model.table)} (${columnSql}) VALUES (${inserted.valuesSql}) ON CONFLICT (${q(column.column)}) DO UPDATE SET ${set} RETURNING ${returningSql(model, args.select)}`,
    [...state.params],
  );
  return oneOrThrow(model, "upsert", rows);
}

export async function executeDelete<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<Row> {
  const state = createCompileState(schema);
  const where = whereUniqueSql(model, args.where, "delete", state);
  const rows = await sql.unsafe<Row[]>(`DELETE FROM ${q(model.table)} WHERE ${where.sql} RETURNING ${returningSql(model, args.select)}`, [...state.params]);
  return oneOrThrow(model, "delete", rows);
}

export async function executeDeleteMany(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: WriteQueryArgs): Promise<MutationCountResult> {
  const state = createCompileState(schema);
  const where = whereManySql(model, args.where, "deleteMany", state);
  const rows = await sql.unsafe<{ count: number }[]>(
    `WITH deleted AS (DELETE FROM ${q(model.table)} AS ${q("wq0")} WHERE ${where} RETURNING 1) SELECT count(*)::int AS "count" FROM deleted`,
    [...state.params],
  );
  return Object.freeze({ count: rows[0]?.count ?? 0 });
}
