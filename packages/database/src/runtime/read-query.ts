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
  readonly pgType?: string;
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly primaryKey: boolean;
  readonly aggregate?: RuntimeColumnAggregateCapabilities;
}

export interface RuntimeColumnAggregateCapabilities {
  readonly count: boolean;
  readonly sum: boolean;
  readonly avg: boolean;
  readonly min: boolean;
  readonly max: boolean;
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
  readonly primaryKeyFields?: readonly string[];
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
  readonly distinct?: unknown;
}

export interface CountQueryArgs {
  readonly where?: unknown;
  readonly select?: unknown;
}

export interface AggregateQueryArgs {
  readonly where?: unknown;
  readonly _count?: unknown;
  readonly _sum?: unknown;
  readonly _avg?: unknown;
  readonly _min?: unknown;
  readonly _max?: unknown;
}

export interface GroupByQueryArgs extends AggregateQueryArgs {
  readonly by?: unknown;
  readonly having?: unknown;
  readonly orderBy?: unknown;
  readonly take?: unknown;
  readonly skip?: unknown;
}

export interface PgExplainOptions {
  readonly analyze?: boolean;
  readonly buffers?: boolean;
  readonly verbose?: boolean;
  readonly costs?: boolean;
  readonly settings?: boolean;
  readonly timing?: boolean;
  readonly summary?: boolean;
  readonly format?: "json" | "text";
}

export interface PgExplainResult<TPlan = unknown> {
  readonly format: "json" | "text";
  readonly analyze: boolean;
  readonly plan: TPlan;
}

export interface CompileState {
  readonly schema: RuntimeReadSchema;
  readonly params: unknown[];
  nextAlias: number;
  readonly maxDepth: number;
  readonly maxTake: number;
}

interface Selection {
  readonly sql: string;
  readonly hasRelation: boolean;
  readonly scalarColumns: readonly RuntimeColumn[];
}

interface OrderedColumn {
  readonly column: RuntimeColumn;
  readonly direction: SortDirection;
}

interface CompiledQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const DEFAULT_FIND_MANY_LIMIT = 100;
const MAX_QUERY_DEPTH = 8;
const MAX_TAKE = 1_000;
const AGGREGATE_OPERATIONS = ["count", "sum", "avg", "min", "max"] as const;
type AggregateOperation = typeof AGGREGATE_OPERATIONS[number];

export function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function columnByField(model: RuntimeModel, field: string): RuntimeColumn | undefined {
  return model.columns.find((column) => column.field === field);
}

function columnByName(model: RuntimeModel, name: string): RuntimeColumn | undefined {
  return model.columns.find((column) => column.column === name);
}

export function relationByField(model: RuntimeModel, field: string): RuntimeRelation | undefined {
  return model.relations.find((relation) => relation.field === field);
}

export function q(name: string): string {
  return quoteIdentifier(name);
}

export function param(state: CompileState, value: unknown): string {
  state.params.push(value);
  return `$${state.params.length}`;
}

export function rejectUndefined(model: RuntimeModel, field: string): never {
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

function parseAggregateTake(model: RuntimeModel, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseQueryError(model.name, "`take` must be a non-negative safe integer.");
  }
  if (value > MAX_TAKE) throw new DatabaseQueryError(model.name, `take must be less than or equal to ${MAX_TAKE}.`);
  return value;
}

function validateExplainBoolean(model: RuntimeModel, options: Readonly<Record<string, unknown>>, field: keyof PgExplainOptions): boolean | undefined {
  const value = options[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new DatabaseQueryError(model.name, `Explain option "${field}" must be a boolean.`);
  return value;
}

function compileExplainPrefix(model: RuntimeModel, options: PgExplainOptions | undefined): { readonly prefix: string; readonly format: "json" | "text"; readonly analyze: boolean } {
  if (options !== undefined && !isPlainObject(options)) throw new DatabaseQueryError(model.name, "Explain options must be an object.");
  const input = options ?? {};
  for (const key of Object.keys(input)) {
    if (key !== "analyze" && key !== "buffers" && key !== "verbose" && key !== "costs" && key !== "settings" && key !== "timing" && key !== "summary" && key !== "format") {
      throw new DatabaseQueryError(model.name, `Unknown explain option "${key}".`);
    }
  }
  const analyze = validateExplainBoolean(model, input, "analyze") === true;
  const buffers = validateExplainBoolean(model, input, "buffers");
  const verbose = validateExplainBoolean(model, input, "verbose");
  const costs = validateExplainBoolean(model, input, "costs");
  const settings = validateExplainBoolean(model, input, "settings");
  const timing = validateExplainBoolean(model, input, "timing");
  const summary = validateExplainBoolean(model, input, "summary");
  const formatValue = input.format;
  if (formatValue !== undefined && formatValue !== "json" && formatValue !== "text") throw new DatabaseQueryError(model.name, 'Explain option "format" must be "json" or "text".');
  if (timing !== undefined && !analyze) throw new DatabaseQueryError(model.name, 'Explain option "timing" requires analyze: true.');
  const format = formatValue ?? "json";
  const parts: string[] = [];
  if (analyze) parts.push("ANALYZE TRUE");
  if (buffers !== undefined) parts.push(`BUFFERS ${buffers ? "TRUE" : "FALSE"}`);
  if (verbose !== undefined) parts.push(`VERBOSE ${verbose ? "TRUE" : "FALSE"}`);
  if (costs !== undefined) parts.push(`COSTS ${costs ? "TRUE" : "FALSE"}`);
  if (settings !== undefined) parts.push(`SETTINGS ${settings ? "TRUE" : "FALSE"}`);
  if (timing !== undefined) parts.push(`TIMING ${timing ? "TRUE" : "FALSE"}`);
  if (summary !== undefined) parts.push(`SUMMARY ${summary ? "TRUE" : "FALSE"}`);
  parts.push(`FORMAT ${format.toUpperCase()}`);
  return { prefix: `EXPLAIN (${parts.join(", ")})`, format, analyze };
}

function extractExplainPlan(format: "json" | "text", rows: readonly Readonly<Record<string, unknown>>[]): unknown {
  if (format === "json") return rows[0]?.["QUERY PLAN"] ?? null;
  return rows.map((row) => row["QUERY PLAN"]).filter((line): line is string => typeof line === "string");
}

async function executeExplain(sql: SQL, model: RuntimeModel, query: CompiledQuery, options?: PgExplainOptions): Promise<PgExplainResult> {
  const explain = compileExplainPrefix(model, options);
  const rows = await sql.unsafe<Readonly<Record<string, unknown>>[]>(`${explain.prefix} ${query.sql}`, [...query.params]);
  return Object.freeze({
    format: explain.format,
    analyze: explain.analyze,
    plan: extractExplainPlan(explain.format, rows),
  });
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
        parts.push(`NOT (${isPlainObject(value) ? compileOperatorFilter(state, model, alias, column, value, depth + 1) : compileScalarComparison(state, model, alias, column, value)})`);
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
  if (!isPlainObject(value)) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" filter must be an object.`);
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

export function compileWhere(state: CompileState, model: RuntimeModel, alias: string, where: unknown, depth: number): string {
  assertDepth(model, depth, state);
  if (where === undefined) return "";
  if (!isPlainObject(where)) throw new DatabaseQueryError(model.name, "`where` must be an object.");
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
      parts.push(isPlainObject(value) ? compileOperatorFilter(state, model, alias, column, value, depth + 1) : compileScalarComparison(state, model, alias, column, value));
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

function normalizeOrderBy(model: RuntimeModel, orderBy: unknown): readonly OrderedColumn[] {
  if (orderBy === undefined) return [];
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  const ordered: OrderedColumn[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isPlainObject(entry)) throw new DatabaseQueryError(model.name, "`orderBy` entries must be objects.");
    for (const [field, direction] of Object.entries(entry)) {
      const column = columnByField(model, field);
      if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown orderBy field "${field}".`);
      if (direction !== "asc" && direction !== "desc") throw new DatabaseQueryError(model.name, `Invalid order direction for "${field}".`);
      if (seen.has(field)) throw new DatabaseQueryError(model.name, `Duplicate orderBy field "${field}".`);
      seen.add(field);
      ordered.push({ column, direction });
    }
  }
  return ordered;
}

function columnReference(alias: string, column: RuntimeColumn): string {
  return `${q(alias)}.${q(column.column)}`;
}

function orderExpression(alias: string, column: RuntimeColumn): string {
  const reference = columnReference(alias, column);
  if (column.pgType === "timestamp" || column.pgType === "timestamptz") {
    return `date_trunc('milliseconds', ${reference})`;
  }
  return reference;
}

function compileOrderBy(state: CompileState, model: RuntimeModel, alias: string, orderBy: unknown): string {
  const ordered = normalizeOrderBy(model, orderBy);
  const parts = compileOrderedColumns(alias, ordered);
  return parts.length === 0 ? "" : `ORDER BY ${parts.join(", ")}`;
}

function compileDefaultOrderBy(model: RuntimeModel, alias: string): string {
  const { column, direction } = defaultOrderedColumn(model);
  return `ORDER BY ${orderExpression(alias, column)} ${direction.toUpperCase()}`;
}

function compileOrderedColumns(alias: string, ordered: readonly OrderedColumn[]): readonly string[] {
  return ordered.map(({ column, direction }) => `${orderExpression(alias, column)} ${direction.toUpperCase()}`);
}

function compileColumnOrderedColumns(alias: string, ordered: readonly OrderedColumn[]): readonly string[] {
  return ordered.map(({ column, direction }) => `${columnReference(alias, column)} ${direction.toUpperCase()}`);
}

function defaultOrderedColumn(model: RuntimeModel): OrderedColumn {
  const column = columnByName(model, model.defaultOrderColumn);
  if (column === undefined) throw new DatabaseQueryError(model.name, "Default order column is unavailable.");
  return { column, direction: "asc" };
}

function primaryKeyFields(model: RuntimeModel): readonly string[] {
  return model.primaryKeyFields ?? model.columns.filter((column) => column.primaryKey).map((column) => column.field);
}

function assertStableCursorOrder(model: RuntimeModel, ordered: readonly OrderedColumn[]): void {
  const orderedFields = new Set(ordered.map(({ column }) => column.field));
  if (ordered.some(({ column }) => column.unique)) return;
  const primary = primaryKeyFields(model);
  if (primary.length > 0 && primary.every((field) => orderedFields.has(field))) return;
  throw new DatabaseQueryError(model.name, "Cursor pagination requires orderBy to include a primary key or unique field as a stable tie-breaker.");
}

function compileCursor(state: CompileState, model: RuntimeModel, alias: string, cursor: unknown, orderBy: unknown): string {
  if (cursor === undefined) return "";
  if (!isPlainObject(cursor)) throw new DatabaseQueryError(model.name, "`cursor` must be a unique selector object.");
  const keys = Object.keys(cursor);
  if (keys.length === 0) throw new DatabaseQueryError(model.name, "`cursor` must contain at least one field.");
  const ordered = normalizeOrderBy(model, orderBy);
  const cursorOrder = ordered.length === 0 ? [defaultOrderedColumn(model)] : ordered;
  const orderedFields = new Set(cursorOrder.map(({ column }) => column.field));
  for (const key of keys) {
    const column = columnByField(model, key);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown cursor field "${key}".`);
    if (!orderedFields.has(key)) throw new DatabaseQueryError(model.name, `Cursor field "${key}" must appear in orderBy.`);
    if (cursor[key] === undefined) rejectUndefined(model, `cursor.${key}`);
  }
  for (const { column } of cursorOrder) {
    if (column.nullable) throw new DatabaseQueryError(model.name, `Cursor order field "${column.field}" is nullable; nullable cursor ordering is not supported.`);
    if (!(column.field in cursor)) throw new DatabaseQueryError(model.name, `Cursor is missing orderBy field "${column.field}".`);
    if (cursor[column.field] === undefined) rejectUndefined(model, `cursor.${column.field}`);
    if (cursor[column.field] === null) throw new DatabaseQueryError(model.name, `Cursor field "${column.field}" cannot be null.`);
  }
  assertStableCursorOrder(model, cursorOrder);
  const placeholders = cursorOrder.map(({ column }) => param(state, cursor[column.field]));
  const branches = cursorOrder.map(({ column, direction }, index) => {
    const comparisons: string[] = [];
    for (let before = 0; before < index; before++) {
      const previous = cursorOrder[before]!;
      comparisons.push(`${orderExpression(alias, previous.column)} = ${placeholders[before]}`);
    }
    comparisons.push(`${orderExpression(alias, column)} ${direction === "asc" ? ">" : "<"} ${placeholders[index]}`);
    return comparisons.length === 1 ? comparisons[0]! : `(${comparisons.join(" AND ")})`;
  });
  return `(${branches.join(" OR ")})`;
}

function normalizeDistinct(model: RuntimeModel, distinct: unknown): readonly RuntimeColumn[] {
  if (distinct === undefined) return [];
  if (!Array.isArray(distinct)) throw new DatabaseQueryError(model.name, "`distinct` must be a non-empty array of scalar field names.");
  if (distinct.length === 0) throw new DatabaseQueryError(model.name, "`distinct` must contain at least one field.");
  const columns: RuntimeColumn[] = [];
  const seen = new Set<string>();
  for (const field of distinct) {
    if (typeof field !== "string") throw new DatabaseQueryError(model.name, "`distinct` entries must be scalar field names.");
    if (seen.has(field)) throw new DatabaseQueryError(model.name, `Duplicate distinct field "${field}".`);
    seen.add(field);
    const column = columnByField(model, field);
    if (column === undefined) {
      if (relationByField(model, field) !== undefined) throw new DatabaseQueryError(model.name, `Relation field "${field}" cannot be used in \`distinct\`.`);
      throw new DatabaseQueryError(model.name, `Unknown distinct field "${field}".`);
    }
    columns.push(column);
  }
  return columns;
}

function assertDistinctOrderCompatible(model: RuntimeModel, distinctColumns: readonly RuntimeColumn[], ordered: readonly OrderedColumn[]): void {
  if (ordered.length === 0) return;
  if (ordered.length < distinctColumns.length) {
    throw new DatabaseQueryError(model.name, "`orderBy` must start with every `distinct` field in the same order.");
  }
  for (let index = 0; index < distinctColumns.length; index++) {
    if (ordered[index]?.column.field !== distinctColumns[index]?.field) {
      throw new DatabaseQueryError(model.name, "`orderBy` must start with every `distinct` field in the same order.");
    }
  }
}

function appendDeterministicDistinctTieBreakers(model: RuntimeModel, ordered: readonly OrderedColumn[]): readonly OrderedColumn[] {
  const seen = new Set(ordered.map(({ column }) => column.field));
  const extra: OrderedColumn[] = [];
  for (const field of primaryKeyFields(model)) {
    if (seen.has(field)) continue;
    const column = columnByField(model, field);
    if (column !== undefined) {
      seen.add(field);
      extra.push({ column, direction: "asc" });
    }
  }
  if (extra.length === 0 && model.defaultOrderColumn !== "") {
    const column = columnByName(model, model.defaultOrderColumn);
    if (column !== undefined && !seen.has(column.field)) extra.push({ column, direction: "asc" });
  }
  return extra.length === 0 ? ordered : [...ordered, ...extra];
}

function distinctOrder(model: RuntimeModel, distinctColumns: readonly RuntimeColumn[], orderBy: unknown): readonly OrderedColumn[] {
  const ordered = normalizeOrderBy(model, orderBy);
  assertDistinctOrderCompatible(model, distinctColumns, ordered);
  const base = ordered.length === 0 ? distinctColumns.map((column) => ({ column, direction: "asc" as const })) : ordered;
  return appendDeterministicDistinctTieBreakers(model, base);
}

function sameColumnSet(left: readonly RuntimeColumn[], right: readonly RuntimeColumn[]): boolean {
  if (left.length !== right.length) return false;
  const fields = new Set(left.map((column) => column.field));
  return right.every((column) => fields.has(column.field));
}

function canUsePlainDistinct(model: RuntimeModel, selection: Selection, distinctColumns: readonly RuntimeColumn[], orderBy: unknown): boolean {
  if (selection.hasRelation) return false;
  if (!sameColumnSet(selection.scalarColumns, distinctColumns)) return false;
  const selectedFields = new Set(selection.scalarColumns.map((column) => column.field));
  const ordered = normalizeOrderBy(model, orderBy);
  return ordered.every(({ column }) => selectedFields.has(column.field));
}

function compilePlainDistinctSql(model: RuntimeModel, alias: string, selection: Selection, distinctColumns: readonly RuntimeColumn[], whereSql: string, orderBy: unknown): string {
  const ordered = normalizeOrderBy(model, orderBy);
  const finalOrder = ordered.length === 0 ? distinctColumns.map((column) => ({ column, direction: "asc" as const })) : ordered;
  const orderBySql = compileColumnOrderedColumns(alias, finalOrder).join(", ");
  return [
    `SELECT DISTINCT ${selection.sql}`,
    `FROM ${q(model.table)} AS ${q(alias)}`,
    whereSql,
    orderBySql.length === 0 ? "" : `ORDER BY ${orderBySql}`,
  ].filter((part) => part.length > 0).join(" ");
}

function compileDistinctSql(model: RuntimeModel, alias: string, selection: Selection, distinctColumns: readonly RuntimeColumn[], whereSql: string, orderBy: unknown): string {
  if (canUsePlainDistinct(model, selection, distinctColumns, orderBy)) {
    return compilePlainDistinctSql(model, alias, selection, distinctColumns, whereSql, orderBy);
  }
  const distinctOn = distinctColumns.map((column) => orderExpression(alias, column)).join(", ");
  const ordered = distinctOrder(model, distinctColumns, orderBy);
  const orderBySql = compileOrderedColumns(alias, ordered).join(", ");
  return [
    `SELECT DISTINCT ON (${distinctOn}) ${selection.sql}`,
    `FROM ${q(model.table)} AS ${q(alias)}`,
    whereSql,
    orderBySql.length === 0 ? "" : `ORDER BY ${orderBySql}`,
  ].filter((part) => part.length > 0).join(" ");
}

export function scalarSelection(model: RuntimeModel, alias: string, fields: readonly string[] | undefined): string[] {
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
    if (!isPlainObject(select)) throw new DatabaseQueryError(model.name, "`select` must be an object.");
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
      if (!isPlainObject(include)) throw new DatabaseQueryError(model.name, "`include` must be an object.");
      for (const [field, value] of Object.entries(include)) {
        if (value === undefined) rejectUndefined(model, `include.${field}`);
        if (value === false) continue;
        const relation = relationByField(model, field);
        if (relation === undefined) throw new DatabaseQueryError(model.name, `Unknown include field "${field}".`);
        relationParts.push(compileRelationSelection(state, model, alias, relation, value === true ? {} : value, depth + 1));
      }
    }
  }

  const scalarColumns = selectFields.map((field) => columnByField(model, field)!);
  const parts = [...scalarSelection(model, alias, selectFields), ...relationParts];
  if (parts.length === 0) throw new DatabaseQueryError(model.name, "At least one field must be selected.");
  return { sql: parts.join(", "), hasRelation: relationParts.length > 0, scalarColumns };
}

function compileRelationSelection(state: CompileState, model: RuntimeModel, alias: string, relation: RuntimeRelation, value: unknown, depth: number): string {
  assertDepth(model, depth, state);
  if (!isPlainObject(value)) throw new DatabaseQueryError(model.name, `Relation "${relation.field}" selection must be an object or true.`);
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

function aggregateCapabilities(column: RuntimeColumn): RuntimeColumnAggregateCapabilities {
  return column.aggregate ?? Object.freeze({
    count: true,
    sum: column.kind === "number",
    avg: column.kind === "number",
    min: column.kind === "string" || column.kind === "number" || column.kind === "date",
    max: column.kind === "string" || column.kind === "number" || column.kind === "date",
  });
}

function aggregateAlias(operation: AggregateOperation, field: string): string {
  return `__wlb_${operation}_${field}`;
}

function assertAggregateAllowed(model: RuntimeModel, column: RuntimeColumn, operation: AggregateOperation): void {
  if (aggregateCapabilities(column)[operation]) return;
  throw new DatabaseQueryError(model.name, `Aggregate "${operation}" is not supported for field "${column.field}".`);
}

function aggregateExpression(model: RuntimeModel, alias: string, operation: AggregateOperation, column?: RuntimeColumn): string {
  if (operation === "count") {
    if (column === undefined) return "count(*)::int";
    assertAggregateAllowed(model, column, operation);
    return `count(${q(alias)}.${q(column.column)})::int`;
  }
  if (column === undefined) throw new DatabaseQueryError(model.name, `Aggregate "${operation}" requires a field.`);
  assertAggregateAllowed(model, column, operation);
  return `${operation}(${q(alias)}.${q(column.column)})`;
}

function assertAggregateSelectionObject(model: RuntimeModel, operation: AggregateOperation, value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw new DatabaseQueryError(model.name, `_${operation} must be true or an object.`);
  return value;
}

function countSelectionParts(model: RuntimeModel, alias: string, select: unknown, target: string[]): void {
  const selection = assertAggregateSelectionObject(model, "count", select);
  for (const [field, enabled] of Object.entries(selection)) {
    if (enabled === undefined) rejectUndefined(model, `_count.${field}`);
    if (enabled === false) continue;
    if (enabled !== true) throw new DatabaseQueryError(model.name, `_count field "${field}" must be true or false.`);
    if (field === "_all") {
      target.push(`${aggregateExpression(model, alias, "count")} AS ${q(aggregateAlias("count", "all"))}`);
      continue;
    }
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown _count field "${field}".`);
    target.push(`${aggregateExpression(model, alias, "count", column)} AS ${q(aggregateAlias("count", field))}`);
  }
}

function aggregateSelectionParts(model: RuntimeModel, alias: string, operation: AggregateOperation, select: unknown, target: string[]): void {
  const selection = assertAggregateSelectionObject(model, operation, select);
  for (const [field, enabled] of Object.entries(selection)) {
    if (enabled === undefined) rejectUndefined(model, `_${operation}.${field}`);
    if (enabled === false) continue;
    if (enabled !== true) throw new DatabaseQueryError(model.name, `_${operation} field "${field}" must be true or false.`);
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown _${operation} field "${field}".`);
    target.push(`${aggregateExpression(model, alias, operation, column)} AS ${q(aggregateAlias(operation, field))}`);
  }
}

function compileAggregateSelections(model: RuntimeModel, alias: string, args: AggregateQueryArgs, allowEmpty: boolean): string[] {
  const parts: string[] = [];
  if (args._count !== undefined) {
    if (args._count === true) parts.push(`${aggregateExpression(model, alias, "count")} AS ${q(aggregateAlias("count", "all"))}`);
    else countSelectionParts(model, alias, args._count, parts);
  }
  if (args._sum !== undefined) aggregateSelectionParts(model, alias, "sum", args._sum, parts);
  if (args._avg !== undefined) aggregateSelectionParts(model, alias, "avg", args._avg, parts);
  if (args._min !== undefined) aggregateSelectionParts(model, alias, "min", args._min, parts);
  if (args._max !== undefined) aggregateSelectionParts(model, alias, "max", args._max, parts);
  if (!allowEmpty && parts.length === 0) throw new DatabaseQueryError(model.name, "At least one aggregate operation must be selected.");
  return parts;
}

function mapCountSelection(model: RuntimeModel, row: Readonly<Record<string, unknown>>, select: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const selection = assertAggregateSelectionObject(model, "count", select);
  for (const [field, enabled] of Object.entries(selection)) {
    if (enabled !== true) continue;
    const key = field === "_all" ? "all" : field;
    result[field] = row[aggregateAlias("count", key)] ?? 0;
  }
  return result;
}

function mapAggregateResult(model: RuntimeModel, row: Readonly<Record<string, unknown>> | undefined, args: AggregateQueryArgs): Record<string, unknown> {
  const source = row ?? {};
  const result: Record<string, unknown> = {};
  if (args._count !== undefined) {
    result._count = args._count === true ? source[aggregateAlias("count", "all")] ?? 0 : mapCountSelection(model, source, args._count);
  }
  for (const operation of ["sum", "avg", "min", "max"] as const) {
    const key = `_${operation}` as const;
    const selection = args[key];
    if (selection === undefined) continue;
    const payload: Record<string, unknown> = {};
    for (const [field, enabled] of Object.entries(assertAggregateSelectionObject(model, operation, selection))) {
      if (enabled === true) payload[field] = source[aggregateAlias(operation, field)] ?? null;
    }
    result[key] = payload;
  }
  return result;
}

function compileAggregateComparison(state: CompileState, model: RuntimeModel, expression: string, value: unknown, path: string): string {
  if (value === undefined) rejectUndefined(model, path);
  if (value === null) return `${expression} IS NULL`;
  if (!isPlainObject(value)) return `${expression} = ${param(state, value)}`;
  const parts: string[] = [];
  for (const [operator, operand] of Object.entries(value)) {
    if (operand === undefined) rejectUndefined(model, `${path}.${operator}`);
    switch (operator) {
      case "equals":
        parts.push(operand === null ? `${expression} IS NULL` : `${expression} = ${param(state, operand)}`);
        break;
      case "not":
        parts.push(`NOT (${compileAggregateComparison(state, model, expression, operand, `${path}.not`)})`);
        break;
      case "in":
      case "notIn": {
        if (!Array.isArray(operand) || operand.length === 0) throw new DatabaseQueryError(model.name, `${path}.${operator} requires a non-empty array.`);
        if (operand.some((item) => item === undefined || item === null)) throw new DatabaseQueryError(model.name, `${path}.${operator} does not accept null or undefined values.`);
        parts.push(`${expression} ${operator === "notIn" ? "NOT " : ""}IN (${operand.map((item) => param(state, item)).join(", ")})`);
        break;
      }
      case "gt":
        parts.push(`${expression} > ${param(state, operand)}`);
        break;
      case "gte":
        parts.push(`${expression} >= ${param(state, operand)}`);
        break;
      case "lt":
        parts.push(`${expression} < ${param(state, operand)}`);
        break;
      case "lte":
        parts.push(`${expression} <= ${param(state, operand)}`);
        break;
      default:
        throw new DatabaseQueryError(model.name, `Unsupported having operator "${operator}" at "${path}".`);
    }
  }
  if (parts.length === 0) throw new DatabaseQueryError(model.name, `Having filter "${path}" cannot be empty.`);
  return parts.join(" AND ");
}

function compileHaving(state: CompileState, model: RuntimeModel, alias: string, having: unknown): string {
  if (having === undefined) return "";
  if (!isPlainObject(having)) throw new DatabaseQueryError(model.name, "`having` must be an object.");
  const parts: string[] = [];
  for (const [field, value] of Object.entries(having)) {
    if (value === undefined) rejectUndefined(model, `having.${field}`);
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown having field "${field}".`);
    if (!isPlainObject(value)) throw new DatabaseQueryError(model.name, `Having field "${field}" must contain aggregate filters.`);
    for (const [operationKey, filter] of Object.entries(value)) {
      if (filter === undefined) rejectUndefined(model, `having.${field}.${operationKey}`);
      const operation = operationKey.startsWith("_") ? operationKey.slice(1) : operationKey;
      if (!AGGREGATE_OPERATIONS.includes(operation as AggregateOperation)) throw new DatabaseQueryError(model.name, `Unsupported having aggregate "${operationKey}".`);
      const aggregate = operation as AggregateOperation;
      parts.push(compileAggregateComparison(state, model, aggregateExpression(model, alias, aggregate, column), filter, `having.${field}.${operationKey}`));
    }
  }
  return parts.length === 0 ? "" : `HAVING ${parts.join(" AND ")}`;
}

function parseGroupByColumns(model: RuntimeModel, by: unknown): readonly RuntimeColumn[] {
  if (!Array.isArray(by)) throw new DatabaseQueryError(model.name, "groupBy `by` must be a non-empty array.");
  if (by.length === 0) throw new DatabaseQueryError(model.name, "groupBy `by` must contain at least one field.");
  const columns: RuntimeColumn[] = [];
  const seen = new Set<string>();
  for (const field of by) {
    if (typeof field !== "string") throw new DatabaseQueryError(model.name, "groupBy `by` entries must be field names.");
    if (seen.has(field)) throw new DatabaseQueryError(model.name, `Duplicate groupBy field "${field}".`);
    const column = columnByField(model, field);
    if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown groupBy field "${field}".`);
    seen.add(field);
    columns.push(column);
  }
  return columns;
}

function compileGroupOrderBy(state: CompileState, model: RuntimeModel, alias: string, orderBy: unknown, groupFields: ReadonlySet<string>): string {
  if (orderBy === undefined) return "";
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts: string[] = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) throw new DatabaseQueryError(model.name, "`orderBy` entries must be objects.");
    for (const [field, value] of Object.entries(entry)) {
      if (field.startsWith("_")) {
        const operation = field.slice(1);
        if (!AGGREGATE_OPERATIONS.includes(operation as AggregateOperation)) throw new DatabaseQueryError(model.name, `Unsupported aggregate orderBy "${field}".`);
        if (!isPlainObject(value)) throw new DatabaseQueryError(model.name, `Aggregate orderBy "${field}" must be an object.`);
        for (const [nestedField, direction] of Object.entries(value)) {
          if (direction !== "asc" && direction !== "desc") throw new DatabaseQueryError(model.name, `Invalid aggregate order direction for "${nestedField}".`);
          if (operation === "count" && nestedField === "_all") {
            parts.push(`${aggregateExpression(model, alias, "count")} ${direction.toUpperCase()}`);
            continue;
          }
          const column = columnByField(model, nestedField);
          if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown aggregate orderBy field "${nestedField}".`);
          parts.push(`${aggregateExpression(model, alias, operation as AggregateOperation, column)} ${direction.toUpperCase()}`);
        }
        continue;
      }
      const column = columnByField(model, field);
      if (column === undefined) throw new DatabaseQueryError(model.name, `Unknown orderBy field "${field}".`);
      if (!groupFields.has(field)) throw new DatabaseQueryError(model.name, `orderBy field "${field}" must be included in groupBy \`by\`.`);
      if (value !== "asc" && value !== "desc") throw new DatabaseQueryError(model.name, `Invalid order direction for "${field}".`);
      parts.push(`${q(alias)}.${q(column.column)} ${value.toUpperCase()}`);
    }
  }
  return parts.length === 0 ? "" : `ORDER BY ${parts.join(", ")}`;
}

function compileReadSql(schema: RuntimeReadSchema, model: RuntimeModel, args: ReadQueryArgs | undefined, mode: "unique" | "first" | "many" | "count"): CompiledQuery {
  const query = args ?? {};
  assertNoSelectInclude(model, query);
  const state: CompileState = { schema, params: [], nextAlias: 1, maxDepth: MAX_QUERY_DEPTH, maxTake: MAX_TAKE };
  const alias = "wq0";
  const distinctColumns = normalizeDistinct(model, query.distinct);
  if (distinctColumns.length > 0 && mode !== "many") throw new DatabaseQueryError(model.name, "`distinct` is only supported on findMany.");
  if (distinctColumns.length > 0 && query.cursor !== undefined) throw new DatabaseQueryError(model.name, "`cursor` cannot be used with `distinct`.");
  if (query.cursor !== undefined && query.skip !== undefined) {
    const skipped = parseSkip(model, query.skip);
    if (skipped !== 0) throw new DatabaseQueryError(model.name, "`skip` cannot be greater than 0 when `cursor` is used.");
  }
  const where = compileWhere(state, model, alias, query.where, 0);
  const cursor = compileCursor(state, model, alias, query.cursor, query.orderBy);
  const predicates = [where, cursor].filter((part) => part.length > 0);
  const whereSql = predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`;
  if (mode === "count") {
    return { sql: `SELECT count(*)::int AS "count" FROM ${q(model.table)} AS ${q(alias)} ${whereSql}`.trim(), params: state.params };
  }
  const selection = compileSelection(state, model, alias, query, 0);
  const orderBy = compileOrderBy(state, model, alias, query.orderBy);
  const defaultOrder = orderBy === "" && (mode === "first" || mode === "many") ? compileDefaultOrderBy(model, alias) : orderBy;
  const take = mode === "first" || mode === "unique" ? 1 : parseTake(model, query.take, DEFAULT_FIND_MANY_LIMIT);
  const skip = parseSkip(model, query.skip);
  const limitSql = take === undefined ? "" : `LIMIT ${take}`;
  const offsetSql = skip === undefined ? "" : `OFFSET ${skip}`;
  if (distinctColumns.length > 0) {
    return {
      sql: `${compileDistinctSql(model, alias, selection, distinctColumns, whereSql, query.orderBy)} ${limitSql} ${offsetSql}`.trim(),
      params: state.params,
    };
  }
  return {
    sql: [
      `SELECT ${selection.sql}`,
      `FROM ${q(model.table)} AS ${q(alias)}`,
      whereSql,
      defaultOrder,
      limitSql,
      offsetSql,
    ].filter((part) => part.length > 0).join(" "),
    params: state.params,
  };
}

function assertUniqueWhere(model: RuntimeModel, args: ReadQueryArgs | undefined): void {
  if (args === undefined || !isPlainObject(args.where)) throw new DatabaseQueryError(model.name, "findUnique requires `where`.");
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

export function createCompileState(schema: RuntimeReadSchema): CompileState {
  return { schema, params: [], nextAlias: 1, maxDepth: MAX_QUERY_DEPTH, maxTake: MAX_TAKE };
}

export function compileWherePredicate(schema: RuntimeReadSchema, model: RuntimeModel, alias: string, where: unknown, requireNonEmpty: boolean): { readonly sql: string; readonly params: readonly unknown[] } {
  const state = createCompileState(schema);
  const predicate = compileWhere(state, model, alias, where, 0);
  if (requireNonEmpty && predicate.length === 0) throw new DatabaseQueryError(model.name, "`where` must contain at least one predicate.");
  return { sql: predicate, params: state.params };
}

export function assertUniqueSelector(model: RuntimeModel, where: unknown, operation: string): Readonly<Record<string, unknown>> {
  if (!isPlainObject(where)) throw new DatabaseQueryError(model.name, `${operation} requires a unique \`where\` object.`);
  const keys = Object.keys(where);
  if (keys.length !== 1) throw new DatabaseQueryError(model.name, `${operation} \`where\` must contain exactly one unique field.`);
  const key = keys[0]!;
  const column = columnByField(model, key);
  if (column === undefined || (!column.primaryKey && !column.unique)) throw new DatabaseQueryError(model.name, `Field "${key}" is not unique.`);
  if (where[key] === undefined) rejectUndefined(model, `where.${key}`);
  return where;
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

function compileCountSelectionSql(schema: RuntimeReadSchema, model: RuntimeModel, args: CountQueryArgs): CompiledQuery {
  const state = createCompileState(schema);
  const alias = "wq0";
  const where = compileWhere(state, model, alias, args.where, 0);
  const whereSql = where.length === 0 ? "" : `WHERE ${where}`;
  const parts: string[] = [];
  countSelectionParts(model, alias, args.select, parts);
  if (parts.length === 0) throw new DatabaseQueryError(model.name, "At least one count field must be selected.");
  return { sql: `SELECT ${parts.join(", ")} FROM ${q(model.table)} AS ${q(alias)} ${whereSql}`.trim(), params: state.params };
}

function compileCountSql(schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs): CompiledQuery {
  if (args?.select !== undefined) return compileCountSelectionSql(schema, model, args);
  return compileReadSql(schema, model, args, "count");
}

export async function executeCount(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs & { readonly select?: undefined }): Promise<number>;
export async function executeCount(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: CountQueryArgs & { readonly select: unknown }): Promise<Record<string, unknown>>;
export async function executeCount(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs): Promise<number | Record<string, unknown>>;
export async function executeCount(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs): Promise<number | Record<string, unknown>> {
  if (args?.select !== undefined) {
    const query = compileCountSql(schema, model, args);
    const rows = await sql.unsafe<Record<string, unknown>[]>(query.sql, [...query.params]);
    return mapCountSelection(model, rows[0] ?? {}, args.select);
  }
  const query = compileCountSql(schema, model, args);
  const rows = await sql.unsafe<{ count: number }[]>(query.sql, [...query.params]);
  return rows[0]?.count ?? 0;
}

function compileExistsSql(schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs): CompiledQuery {
  const state = createCompileState(schema);
  const alias = "wq0";
  const where = compileWhere(state, model, alias, args?.where, 0);
  const whereSql = where.length === 0 ? "" : `WHERE ${where}`;
  return {
    sql: `SELECT EXISTS (${[
      "SELECT 1",
      `FROM ${q(model.table)} AS ${q(alias)}`,
      whereSql,
    ].filter((part) => part.length > 0).join(" ")}) AS "exists"`,
    params: state.params,
  };
}

export async function executeExists(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs): Promise<boolean> {
  const query = compileExistsSql(schema, model, args);
  const rows = await sql.unsafe<{ exists: boolean }[]>(
    query.sql,
    [...query.params],
  );
  return rows[0]?.exists === true;
}

function compileAggregateSql(schema: RuntimeReadSchema, model: RuntimeModel, args: AggregateQueryArgs): CompiledQuery {
  if (!isPlainObject(args)) throw new DatabaseQueryError(model.name, "aggregate args must be an object.");
  for (const key of Object.keys(args)) {
    if (key !== "where" && key !== "_count" && key !== "_sum" && key !== "_avg" && key !== "_min" && key !== "_max") {
      throw new DatabaseQueryError(model.name, `Unknown aggregate option "${key}".`);
    }
  }
  const state = createCompileState(schema);
  const alias = "wq0";
  const selections = compileAggregateSelections(model, alias, args, false);
  const where = compileWhere(state, model, alias, args.where, 0);
  const whereSql = where.length === 0 ? "" : `WHERE ${where}`;
  return {
    sql: `SELECT ${selections.join(", ")} FROM ${q(model.table)} AS ${q(alias)} ${whereSql}`.trim(),
    params: state.params,
  };
}

export async function executeAggregate(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: AggregateQueryArgs): Promise<Record<string, unknown>> {
  const query = compileAggregateSql(schema, model, args);
  const rows = await sql.unsafe<Record<string, unknown>[]>(
    query.sql,
    [...query.params],
  );
  return mapAggregateResult(model, rows[0], args);
}

function compileGroupBySql(schema: RuntimeReadSchema, model: RuntimeModel, args: GroupByQueryArgs): CompiledQuery & { readonly groupColumns: readonly RuntimeColumn[] } {
  if (!isPlainObject(args)) throw new DatabaseQueryError(model.name, "groupBy args must be an object.");
  for (const key of Object.keys(args)) {
    if (key !== "by" && key !== "where" && key !== "having" && key !== "orderBy" && key !== "take" && key !== "skip" && key !== "_count" && key !== "_sum" && key !== "_avg" && key !== "_min" && key !== "_max") {
      throw new DatabaseQueryError(model.name, `Unknown groupBy option "${key}".`);
    }
  }
  const state = createCompileState(schema);
  const alias = "wq0";
  const groupColumns = parseGroupByColumns(model, args.by);
  const groupFields = new Set(groupColumns.map((column) => column.field));
  const groupSelections = groupColumns.map((column) => `${q(alias)}.${q(column.column)} AS ${q(column.field)}`);
  const aggregateSelections = compileAggregateSelections(model, alias, args, true);
  const where = compileWhere(state, model, alias, args.where, 0);
  const whereSql = where.length === 0 ? "" : `WHERE ${where}`;
  const groupBy = `GROUP BY ${groupColumns.map((column) => `${q(alias)}.${q(column.column)}`).join(", ")}`;
  const having = compileHaving(state, model, alias, args.having);
  const orderBy = compileGroupOrderBy(state, model, alias, args.orderBy, groupFields);
  const take = parseAggregateTake(model, args.take);
  const skip = parseSkip(model, args.skip);
  const limitSql = take === undefined ? "" : `LIMIT ${take}`;
  const offsetSql = skip === undefined ? "" : `OFFSET ${skip}`;
  return {
    sql: [
      `SELECT ${[...groupSelections, ...aggregateSelections].join(", ")}`,
      `FROM ${q(model.table)} AS ${q(alias)}`,
      whereSql,
      groupBy,
      having,
      orderBy,
      limitSql,
      offsetSql,
    ].filter((part) => part.length > 0).join(" "),
    params: state.params,
    groupColumns,
  };
}

export async function executeGroupBy(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: GroupByQueryArgs): Promise<readonly Record<string, unknown>[]> {
  const query = compileGroupBySql(schema, model, args);
  const rows = await sql.unsafe<Record<string, unknown>[]>(
    query.sql,
    [...query.params],
  );
  return rows.map((row) => Object.freeze({
    ...Object.fromEntries(query.groupColumns.map((column) => [column.field, row[column.field]])),
    ...mapAggregateResult(model, row, args),
  }));
}

export async function executeExplainFindUnique(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: ReadQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  assertUniqueWhere(model, args);
  return executeExplain(sql, model, compileReadSql(schema, model, args, "unique"), options);
}

export async function executeExplainFindFirst(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: ReadQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  return executeExplain(sql, model, compileReadSql(schema, model, args, "first"), options);
}

export async function executeExplainFindMany(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: ReadQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  return executeExplain(sql, model, compileReadSql(schema, model, args, "many"), options);
}

export async function executeExplainCount(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  return executeExplain(sql, model, compileCountSql(schema, model, args), options);
}

export async function executeExplainExists(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args?: CountQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  return executeExplain(sql, model, compileExistsSql(schema, model, args), options);
}

export async function executeExplainAggregate(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: AggregateQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  return executeExplain(sql, model, compileAggregateSql(schema, model, args), options);
}

export async function executeExplainGroupBy(sql: SQL, schema: RuntimeReadSchema, model: RuntimeModel, args: GroupByQueryArgs, options?: PgExplainOptions): Promise<PgExplainResult> {
  return executeExplain(sql, model, compileGroupBySql(schema, model, args), options);
}
