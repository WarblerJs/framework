import type { SQL } from "bun";
import { DatabaseQueryError, DatabaseRecordNotFoundError } from "../errors";
import { quoteIdentifier } from "../utils/sql-identifier";

export type SortDirection = "asc" | "desc";

export type EqualityFilter<T> = T | {
  readonly equals?: T;
  readonly not?: T | EqualityFilter<T>;
  readonly in?: readonly NonNullable<T>[];
  readonly notIn?: readonly NonNullable<T>[];
};

export type ComparableFilter<T> = EqualityFilter<T> & {
  readonly gt?: NonNullable<T>;
  readonly gte?: NonNullable<T>;
  readonly lt?: NonNullable<T>;
  readonly lte?: NonNullable<T>;
};

export type StringFilter<T> = ComparableFilter<T> & {
  readonly contains?: string;
  readonly startsWith?: string;
  readonly endsWith?: string;
};

export interface RuntimeColumn {
  readonly field: string;
  readonly column: string;
  readonly kind: "string" | "number" | "boolean" | "date" | "bytes" | "json";
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly primaryKey: boolean;
}

export interface RuntimeRelation {
  readonly field: string;
  readonly kind: "one" | "many";
  readonly target: string;
  readonly localColumn: string;
  readonly foreignColumn: string;
}

export interface RuntimeModel {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly RuntimeColumn[];
  readonly relations: readonly RuntimeRelation[];
  readonly defaultOrderColumn: string;
}

export interface RuntimeReadSchema {
  readonly models: Readonly<Record<string, RuntimeModel>>;
}

export interface ReadQueryArgs {
  readonly where?: unknown;
  readonly select?: unknown;
  readonly include?: unknown;
  readonly orderBy?: unknown;
  readonly take?: unknown;
  readonly skip?: unknown;
  readonly cursor?: unknown;
}

export interface CountQueryArgs {
  readonly where?: unknown;
}

interface CompileState {
  readonly schema: RuntimeReadSchema;
  readonly params: unknown[];
  nextAlias: number;
  readonly maxDepth: number;
  readonly maxTake: number;
}

interface Selection {
  readonly sql: string;
  readonly hasRelation: boolean;
}

const DEFAULT_FIND_MANY_LIMIT = 100;
const MAX_QUERY_DEPTH = 8;
const MAX_TAKE = 1_000;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function columnByField(model: RuntimeModel, field: string): RuntimeColumn | undefined {
  return model.columns.find((column) => column.field === field);
}

function columnByName(model: RuntimeModel, name: string): RuntimeColumn | undefined {
  return model.columns.find((column) => column.column === name);
}

function relationByField(model: RuntimeModel, field: string): RuntimeRelation | undefined {
  return model.relations.find((relation) => relation.field === field);
}

function q(name: string): string {
  return quoteIdentifier(name);
}

function param(state: CompileState, value: unknown): string {
  state.params.push(value);
  return `$${state.params.length}`;
}

function rejectUndefined(model: RuntimeModel, field: string): never {
  throw new DatabaseQueryError(model.name, `Field "${field}" was explicitly set to undefined.`);
}

function assertDepth(model: RuntimeModel, depth: number, state: CompileState): void {
  if (depth > state.maxDepth) throw new DatabaseQueryError(model.name, `Query nesting exceeds the maximum depth of ${state.maxDepth}.`);
}

function assertNoSelectInclude(model: RuntimeModel, args: ReadQueryArgs): void {
  if (args.select !== undefined && args.include !== undefined) {
    throw new DatabaseQueryError(model.name, "`select` and `include` cannot be used together at the same level.");
  }
}

function parseTake(model: RuntimeModel, value: unknown, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseQueryError(model.name, "`take` must be a non-negative safe integer.");
  }
  if (value > MAX_TAKE) throw new DatabaseQueryError(model.name, `take must be less than or equal to ${MAX_TAKE}.`);
  return value;
}

function parseSkip(model: RuntimeModel, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseQueryError(model.name, "`skip` must be a non-negative safe integer.");
  }
  return value;
}

function compileScalarComparison(state: CompileState, model: RuntimeModel, alias: string, column: RuntimeColumn, value: unknown): string {
  const left = `${q(alias)}.${q(column.column)}`;
  if (value === undefined) rejectUndefined(model, column.field);
  if (value === null) return column.nullable ? `${left} IS NULL` : `${left} IS NULL`;
  return `${left} = ${param(state, value)}`;
}

function assertOperatorAllowed(model: RuntimeModel, column: RuntimeColumn, operator: string): void {
  const common = new Set(["equals", "not", "in", "notIn"]);
  const comparable = new Set(["gt", "gte", "lt", "lte"]);
  const stringOnly = new Set(["contains", "startsWith", "endsWith"]);
  if (common.has(operator)) return;
  if (comparable.has(operator) && (column.kind === "string" || column.kind === "number" || column.kind === "date")) return;
  if (stringOnly.has(operator) && column.kind === "string") return;
  throw new DatabaseQueryError(model.name, `Operator "${operator}" is not supported for field "${column.field}".`);
}

function compileOperatorFilter(state: CompileState, model: RuntimeModel, alias: string, column: RuntimeColumn, filter: Readonly<Record<string, unknown>>, depth: number): string {
  const parts: string[] = [];
  const left = `${q(alias)}.${q(column.column)}`;
  for (const [operator, value] of Object.entries(filter)) {
    if (value === undefined) rejectUndefined(model, `${column.field}.${operator}`);
    assertOperatorAllowed(model, column, operator);
    switch (operator) {
      case "equals":
        parts.push(compileScalarComparison(state, model, alias, column, value));
        break;
      case "not":
        parts.push(`NOT (${isObject(value) ? compileOperatorFilter(state, model, alias, column, value, depth + 1) : compileScalarComparison(state, model, alias, column, value)})`);
        break;
      case "in":
      case "notIn": {
        if (!Array.isArray(value) || value.length === 0) throw new DatabaseQueryError(model.name, `${operator} requires a non-empty array.`);
        if (value.some((item) => item === undefined || item === null)) throw new DatabaseQueryError(model.name, `${operator} does not accept null or undefined values.`);
        const list = value.map((item) => param(state, item)).join(", ");
        parts.push(`${left} ${operator === "notIn" ? "NOT " : ""}IN (${list})`);
        break;
      }
      case "gt":
        parts.push(`${left} > ${param(state, value)}`);
        break;
      case "gte":
        parts.push(`${left} >= ${param(state, value)}`);
        break;
      case "lt":
        parts.push(`${left} < ${param(state, value)}`);
        break;
      case "lte":
        parts.push(`${left} <= ${param(state, value)}`);
        break;
      case "contains":
        parts.push(`${left} LIKE ${param(state, `%${String(value)}%`)}`);
        break;
      case "startsWith":
        parts.push(`${left} LIKE ${param(state, `${String(value)}%`)}`);
        break;
      case "endsWith":
        parts.push(`${left} LIKE ${param(state, `%${String(value)}`)}`);
        break;
      default:
        throw new DatabaseQueryError(model.name, `Unsupported operator "${operator}".`);
    }
  }
  if (parts.length === 0) throw new DatabaseQueryError(model.name, `Field "${column.field}" filter cannot be empty.`);
  return parts.join(" AND ");
}

function compileRelationFilter(state: CompileState, model: RuntimeModel, alias: string, relation: RuntimeRelation, value: unknown, depth: number): string {
  if (!isObject(value)) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" filter must be an object.`);
  const target = state.schema.models[relation.target];
  if (target === undefined) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" target is unavailable.`);
  const relationAlias = `wq${state.nextAlias++}`;
  const join = `${q(relationAlias)}.${q(relation.foreignColumn)} = ${q(alias)}.${q(relation.localColumn)}`;
  const existsFor = (where: unknown, negateWhere: boolean): string => {
    const predicate = compileWhere(state, target, relationAlias, where, depth + 1);
    const whereSql = predicate === "" ? join : `${join} AND ${negateWhere ? `NOT (${predicate})` : predicate}`;
    return `EXISTS (SELECT 1 FROM ${q(target.table)} AS ${q(relationAlias)} WHERE ${whereSql})`;
  };

  if (relation.kind === "many") {
    const allowed = new Set(["some", "none", "every"]);
    const parts: string[] = [];
    for (const [operator, nested] of Object.entries(value)) {
      if (!allowed.has(operator)) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" supports some, none, and every.`);
      if (nested === undefined) rejectUndefined(model, `${relation.field}.${operator}`);
      if (operator === "some") parts.push(existsFor(nested, false));
      else if (operator === "none") parts.push(`NOT (${existsFor(nested, false)})`);
      else parts.push(`NOT (${existsFor(nested, true)})`);
    }
    if (parts.length === 0) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" filter cannot be empty.`);
    return parts.join(" AND ");
  }

  const allowed = new Set(["is", "isNot"]);
  const parts: string[] = [];
  for (const [operator, nested] of Object.entries(value)) {
    if (!allowed.has(operator)) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" supports is and isNot.`);
    if (nested === undefined) rejectUndefined(model, `${relation.field}.${operator}`);
    parts.push(operator === "is" ? existsFor(nested, false) : `NOT (${existsFor(nested, false)})`);
  }
  if (parts.length === 0) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" filter cannot be empty.`);
  return parts.join(" AND ");
}

function normalizeLogical(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

function compileWhere(state: CompileState, model: RuntimeModel, alias: string, where: unknown, depth: number): string {
  assertDepth(model, depth, state);
  if (where === undefined) return "";
  if (!isObject(where)) throw new DatabaseQueryError(model.name, "`where` must be an object.");
  const parts: string[] = [];
  for (const [field, value] of Object.entries(where)) {
    if (value === undefined) rejectUndefined(model, field);
    if (field === "AND" || field === "OR") {
      const children = normalizeLogical(value).map((item) => compileWhere(state, model, alias, item, depth + 1)).filter((item) => item.length > 0);
      if (children.length > 0) parts.push(`(${children.join(field === "AND" ? " AND " : " OR ")})`);
      continue;
    }
    if (field === "NOT") {
      const children = normalizeLogical(value).map((item) => compileWhere(state, model, alias, item, depth + 1)).filter((item) => item.length > 0);
      if (children.length > 0) parts.push(`NOT (${children.join(" AND ")})`);
      continue;
    }
    const column = columnByField(model, field);
    if (column !== undefined) {
      parts.push(isObject(value) ? compileOperatorFilter(state, model, alias, column, value, depth + 1) : compileScalarComparison(state, model, alias, column, value));
      continue;
    }
    const relation = relationByField(model, field);
    if (relation !== undefined) {
      parts.push(compileRelationFilter(state, model, alias, relation, value, depth + 1));
      continue;
    }
    throw new DatabaseQueryError(model.name, `Unknown where field "${field}".`);
  }
  return parts.join(" AND ");
}

function compileOrderBy(state: CompileState, model: RuntimeModel, alias: string, orderBy: unknown): string {
  if (orderBy === undefined) return "";
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts: string[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) throw new DatabaseQueryError(model.name, "`orderBy` entries must be objects.");
    for (const [field, direction] of Object.entries(entry)) {
      const column = columnByField(model, field);
      if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown orderBy field "${field}".`);
      if (direction !== "asc" && direction !== "desc") throw new DatabaseQueryError(model.name, `Invalid order direction for "${field}".`);
      parts.push(`${q(alias)}.${q(column.column)} ${direction.toUpperCase()}`);
    }
  }
  return parts.length === 0 ? "" : `ORDER BY ${parts.join(", ")}`;
}

function compileCursor(state: CompileState, model: RuntimeModel, alias: string, cursor: unknown, orderBy: unknown): string {
  if (cursor === undefined) return "";
  if (!isObject(cursor)) throw new DatabaseQueryError(model.name, "`cursor` must be a unique selector object.");
  const keys = Object.keys(cursor);
  if (keys.length !== 1) throw new DatabaseQueryError(model.name, "`cursor` must contain exactly one unique field.");
  const field = keys[0]!;
  const column = columnByField(model, field);
  if (column === undefined || (!column.primaryKey && !column.unique)) throw new DatabaseQueryError(model.name, `Cursor field "${field}" is not unique.`);
  const value = cursor[field];
  if (value === undefined) rejectUndefined(model, `cursor.${field}`);
  const direction = isObject(orderBy) && orderBy[field] === "desc" ? "<" : ">";
  return `${q(alias)}.${q(column.column)} ${direction} ${param(state, value)}`;
}

function scalarSelection(model: RuntimeModel, alias: string, fields: readonly string[] | undefined): string[] {
  const selected = fields === undefined ? model.columns : fields.map((field) => {
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown select field "${field}".`);
    return column;
  });
  return selected.map((column) => `${q(alias)}.${q(column.column)} AS ${q(column.field)}`);
}

function compileSelection(state: CompileState, model: RuntimeModel, alias: string, args: ReadQueryArgs, depth: number): Selection {
  assertNoSelectInclude(model, args);
  const select = args.select;
  const include = args.include;
  const selectFields: string[] = [];
  const relationParts: string[] = [];

  if (select !== undefined) {
    if (!isObject(select)) throw new DatabaseQueryError(model.name, "`select` must be an object.");
    for (const [field, value] of Object.entries(select)) {
      if (value === undefined) rejectUndefined(model, `select.${field}`);
      const column = columnByField(model, field);
      if (column !== undefined) {
        if (value === true) selectFields.push(field);
        else if (value !== false) throw new DatabaseQueryError(model.name, `Scalar select "${field}" must be true or false.`);
        continue;
      }
      const relation = relationByField(model, field);
      if (relation === undefined) throw new DatabaseQueryError(model.name, `Unknown select field "${field}".`);
      if (value === false) continue;
      relationParts.push(compileRelationSelection(state, model, alias, relation, value === true ? {} : value, depth + 1));
    }
  } else {
    selectFields.push(...model.columns.map((column) => column.field));
    if (include !== undefined) {
      if (!isObject(include)) throw new DatabaseQueryError(model.name, "`include` must be an object.");
      for (const [field, value] of Object.entries(include)) {
        if (value === undefined) rejectUndefined(model, `include.${field}`);
        if (value === false) continue;
        const relation = relationByField(model, field);
        if (relation === undefined) throw new DatabaseQueryError(model.name, `Unknown include field "${field}".`);
        relationParts.push(compileRelationSelection(state, model, alias, relation, value === true ? {} : value, depth + 1));
      }
    }
  }

  const parts = [...scalarSelection(model, alias, selectFields), ...relationParts];
  if (parts.length === 0) throw new DatabaseQueryError(model.name, "At least one field must be selected.");
  return { sql: parts.join(", "), hasRelation: relationParts.length > 0 };
}

function compileRelationSelection(state: CompileState, model: RuntimeModel, alias: string, relation: RuntimeRelation, value: unknown, depth: number): string {
  assertDepth(model, depth, state);
  if (!isObject(value)) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" selection must be an object or true.`);
  const target = state.schema.models[relation.target];
  if (target === undefined) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" target is unavailable.`);
  const relationAlias = `wq${state.nextAlias++}`;
  const relationArgs = value as ReadQueryArgs;
  const selection = compileSelection(state, target, relationAlias, relationArgs, depth + 1);
  const where = compileWhere(state, target, relationAlias, relationArgs.where, depth + 1);
  const relationWhere = `${q(relationAlias)}.${q(relation.foreignColumn)} = ${q(alias)}.${q(relation.localColumn)}${where === "" ? "" : ` AND ${where}`}`;
  const orderBy = compileOrderBy(state, target, relationAlias, relationArgs.orderBy);
  const take = parseTake(target, relationArgs.take);
  const skip = parseSkip(target, relationArgs.skip);
  const limitSql = take === undefined ? "" : `LIMIT ${take}`;
  const offsetSql = skip === undefined ? "" : `OFFSET ${skip}`;
  const subquery = `SELECT ${selection.sql} FROM ${q(target.table)} AS ${q(relationAlias)} WHERE ${relationWhere} ${orderBy} ${limitSql} ${offsetSql}`.trim();
  if (relation.kind === "many") {
    return `COALESCE((SELECT json_agg(row_to_json(${q(`${relationAlias}_row`)})) FROM (${subquery}) AS ${q(`${relationAlias}_row`)}), '[]'::json) AS ${q(relation.field)}`;
  }
  return `(SELECT row_to_json(${q(`${relationAlias}_row`)}) FROM (${subquery} LIMIT 1) AS ${q(`${relationAlias}_row`)}) AS ${q(relation.field)}`;
}

function compileReadSql(schema: RuntimeReadSchema, model: RuntimeModel, args: ReadQueryArgs | undefined, mode: "unique" | "first" | "many" | "count"): { readonly sql: string; readonly params: readonly unknown[] } {
  const query = args ?? {};
  assertNoSelectInclude(model, query);
  const state: CompileState = { schema, params: [], nextAlias: 1, maxDepth: MAX_QUERY_DEPTH, maxTake: MAX_TAKE };
  const alias = "wq0";
  const where = compileWhere(state, model, alias, query.where, 0);
  const cursor = compileCursor(state, model, alias, query.cursor, query.orderBy);
  const predicates = [where, cursor].filter((part) => part.length > 0);
  const whereSql = predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`;
  if (mode === "count") {
    return { sql: `SELECT count(*)::int AS "count" FROM ${q(model.table)} AS ${q(alias)} ${whereSql}`.trim(), params: state.params };
  }
  const selection = compileSelection(state, model, alias, query, 0);
  const orderBy = compileOrderBy(state, model, alias, query.orderBy);
  const defaultOrder = orderBy === "" && (mode === "first" || mode === "many") ? `ORDER BY ${q(alias)}.${q(model.defaultOrderColumn)} ASC` : orderBy;
  const take = mode === "first" || mode === "unique" ? 1 : parseTake(model, query.take, DEFAULT_FIND_MANY_LIMIT);
  const skip = parseSkip(model, query.skip);
  const limitSql = take === undefined ? "" : `LIMIT ${take}`;
  const offsetSql = skip === undefined ? "" : `OFFSET ${skip}`;
  return {
    sql: `SELECT ${selection.sql} FROM ${q(model.table)} AS ${q(alias)} ${whereSql} ${defaultOrder} ${limitSql} ${offsetSql}`.trim(),
    params: state.params,
  };
}

function assertUniqueWhere(model: RuntimeModel, args: ReadQueryArgs | undefined): void {
  if (args === undefined || !isObject(args.where)) throw new DatabaseQueryError(model.name, "findUnique requires `where`.");
  const keys = Object.keys(args.where);
  if (keys.length !== 1) throw new DatabaseQueryError(model.name, "findUnique `where` must contain exactly one unique field.");
  const column = columnByField(model, keys[0]!);
  if (column === undefined || (!column.primaryKey && !column.unique)) {
    throw new DatabaseQueryError(model.name, `Field "${keys[0]!}" is not unique.`);
  }
}

export async function executeFindUnique<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: ReadQueryArgs): Promise<Row | null> {
  assertUniqueWhere(model, args);
  const query = compileReadSql(schema, model, args, "unique");
  const rows = await sql.unsafe<Row[]>(query.sql, [...query.params]);
  return rows[0] ?? null;
}

export async function executeFindUniqueOrThrow<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: ReadQueryArgs): Promise<Row> {
  const row = await executeFindUnique<Row>(sql, schema, model, args);
  if (row === null) throw new DatabaseRecordNotFoundError(model.name, "findUniqueOrThrow");
  return row;
}

export async function executeFindFirst<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: ReadQueryArgs): Promise<Row | null> {
  const query = compileReadSql(schema, model, args, "first");
  const rows = await sql.unsafe<Row[]>(query.sql, [...query.params]);
  return rows[0] ?? null;
}

export async function executeFindFirstOrThrow<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: ReadQueryArgs): Promise<Row> {
  const row = await executeFindFirst<Row>(sql, schema, model, args);
  if (row === null) throw new DatabaseRecordNotFoundError(model.name, "findFirstOrThrow");
  return row;
}

export async function executeFindMany<Row>(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: ReadQueryArgs): Promise<Row[]> {
  const query = compileReadSql(schema, model, args, "many");
  return sql.unsafe<Row[]>(query.sql, [...query.params]);
}

export async function executeCount(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs): Promise<number> {
  const query = compileReadSql(schema, model, args, "count");
  const rows = await sql.unsafe<{ count: number }[]>(query.sql, [...query.params]);
  return rows[0]?.count ?? 0;
}
