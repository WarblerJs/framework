import type { SQL } from "bun";
import { tableNameToClientKey, tableNameToModelName } from "../naming";
import type {
  CheckConstraintMetadata,
  ColumnMetadata,
  EnumTypeMetadata,
  ForeignKeyMetadata,
  IndexMetadata,
  TableMetadata,
} from "../types/model.types";
import { mapPgType, type ColumnTypeInfo } from "./map-pg-type";

export interface IntrospectDatabaseOptions {
  readonly excludeTables: readonly string[];
  readonly modelNames?: Readonly<Record<string, string>>;
}

interface TableRow {
  readonly tableName: string;
}

interface ColumnRow extends ColumnTypeInfo {
  readonly tableName: string;
  readonly columnName: string;
  readonly isNullable: string;
  readonly columnDefault: string | null;
  readonly isIdentity: string;
}

interface IndexRow {
  readonly tableName: string;
  readonly indexName: string;
  readonly isPrimary: boolean;
  readonly isUnique: boolean;
  readonly columns: readonly string[];
}

const ACTION_BY_CHAR: Readonly<Record<string, "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION">> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

interface ForeignKeyRow {
  readonly tableName: string;
  readonly columnName: string;
  readonly referencesTable: string;
  readonly referencesColumn: string;
  readonly onDelete: string;
  readonly onUpdate: string;
}

interface CheckRow {
  readonly tableName: string;
  readonly columnName: string;
  readonly definition: string;
}

interface EnumRow {
  readonly name: string;
  readonly value: string;
}

interface CommentRow {
  readonly tableName: string;
  readonly columnName: string;
  readonly comment: string;
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const group = groups.get(groupKey);
    if (group === undefined) groups.set(groupKey, [row]);
    else group.push(row);
  }
  return groups;
}

async function fetchTables(sql: SQL): Promise<readonly TableRow[]> {
  return sql<TableRow[]>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
}

async function fetchColumns(sql: SQL): Promise<readonly ColumnRow[]> {
  return sql<ColumnRow[]>`
    SELECT
      table_name AS "tableName",
      column_name AS "columnName",
      data_type AS "dataType",
      udt_name AS "udtName",
      character_maximum_length AS "characterMaximumLength",
      numeric_precision AS "numericPrecision",
      numeric_scale AS "numericScale",
      datetime_precision AS "datetimePrecision",
      is_nullable AS "isNullable",
      column_default AS "columnDefault",
      is_identity AS "isIdentity"
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
}

async function fetchIndexes(sql: SQL): Promise<readonly IndexRow[]> {
  return sql<IndexRow[]>`
    SELECT
      t.relname AS "tableName",
      i.relname AS "indexName",
      ix.indisprimary AS "isPrimary",
      ix.indisunique AS "isUnique",
      array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS "columns"
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE n.nspname = 'public' AND t.relkind = 'r'
    GROUP BY t.relname, i.relname, ix.indisprimary, ix.indisunique
    ORDER BY t.relname, i.relname
  `;
}

async function fetchForeignKeys(sql: SQL): Promise<readonly ForeignKeyRow[]> {
  return sql<ForeignKeyRow[]>`
    SELECT
      t.relname AS "tableName",
      a.attname AS "columnName",
      ft.relname AS "referencesTable",
      fa.attname AS "referencesColumn",
      con.confdeltype AS "onDelete",
      con.confupdtype AS "onUpdate"
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_class ft ON ft.oid = con.confrelid
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE con.contype = 'f' AND n.nspname = 'public' AND array_length(con.conkey, 1) = 1
    ORDER BY t.relname, a.attname
  `;
}

async function fetchCheckConstraints(sql: SQL): Promise<readonly CheckRow[]> {
  return sql<CheckRow[]>`
    SELECT
      t.relname AS "tableName",
      a.attname AS "columnName",
      pg_get_constraintdef(con.oid) AS "definition"
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'c' AND n.nspname = 'public' AND array_length(con.conkey, 1) = 1
    ORDER BY t.relname, a.attname
  `;
}

async function fetchEnums(sql: SQL): Promise<readonly EnumRow[]> {
  return sql<EnumRow[]>`
    SELECT t.typname AS "name", e.enumlabel AS "value"
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `;
}

async function fetchColumnComments(sql: SQL): Promise<readonly CommentRow[]> {
  return sql<CommentRow[]>`
    SELECT
      c.relname AS "tableName",
      a.attname AS "columnName",
      col_description(c.oid, a.attnum) AS "comment"
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND col_description(c.oid, a.attnum) IS NOT NULL
  `;
}

function stripCheckWrapper(definition: string): string {
  const match = /^CHECK\s*\((.*)\)$/su.exec(definition.trim());
  return match?.[1] ?? definition;
}

/** Queries PostgreSQL system catalogs and produces `TableMetadata[]` directly — no `ColumnBuilder`s, no model files. */
export async function introspectDatabase(sql: SQL, options: IntrospectDatabaseOptions): Promise<readonly TableMetadata[]> {
  const excluded = new Set(options.excludeTables);
  const modelNames = options.modelNames ?? {};

  const [tableRows, columnRows, indexRows, foreignKeyRows, checkRows, enumRows, commentRows] = await Promise.all([
    fetchTables(sql),
    fetchColumns(sql),
    fetchIndexes(sql),
    fetchForeignKeys(sql),
    fetchCheckConstraints(sql),
    fetchEnums(sql),
    fetchColumnComments(sql),
  ]);

  const tableNames = tableRows.map((row) => row.tableName).filter((name) => !excluded.has(name)).sort(compareText);

  const enumsByName = new Map<string, EnumTypeMetadata>();
  for (const [name, rows] of groupBy(enumRows, (row) => row.name)) {
    enumsByName.set(name, Object.freeze({ name, values: Object.freeze(rows.map((row) => row.value)) }));
  }

  const columnsByTable = groupBy(columnRows, (row) => row.tableName);
  const indexesByTable = groupBy(indexRows, (row) => row.tableName);
  const foreignKeysByTable = groupBy(foreignKeyRows, (row) => row.tableName);
  const checksByTable = groupBy(checkRows, (row) => row.tableName);
  const commentsByTable = groupBy(commentRows, (row) => row.tableName);

  return Object.freeze(tableNames.map((tableName) => {
    const commentByColumn = new Map(
      (commentsByTable.get(tableName) ?? []).map((row) => [row.columnName, row.comment] as const),
    );

    const columns: ColumnMetadata[] = (columnsByTable.get(tableName) ?? []).map((row) => {
      const hasSequenceDefault = row.columnDefault !== null && /^nextval\(/u.test(row.columnDefault);
      const mapped = mapPgType(row, hasSequenceDefault);
      const isSerial = mapped.pgType === "smallserial" || mapped.pgType === "serial" || mapped.pgType === "bigserial";
      const comment = commentByColumn.get(row.columnName);
      const enumMetadata = mapped.pgType === "enum" ? enumsByName.get(mapped.sqlType) : undefined;
      return Object.freeze({
        fieldName: row.columnName,
        columnName: row.columnName,
        pgType: mapped.pgType,
        sqlType: mapped.sqlType,
        nullable: row.isNullable === "YES",
        ...(row.columnDefault === null || isSerial ? {} : { default: Object.freeze({ raw: row.columnDefault }) }),
        unique: false,
        primaryKey: false,
        identity: row.isIdentity === "YES",
        index: false,
        ...(comment === undefined ? {} : { comment }),
        ...(enumMetadata === undefined ? {} : { enum: enumMetadata }),
      });
    });

    const primaryKey: string[] = [];
    const indexes: IndexMetadata[] = [];
    for (const row of indexesByTable.get(tableName) ?? []) {
      if (row.isPrimary) {
        primaryKey.push(...row.columns);
        continue;
      }
      if (row.columns.length !== 1) continue;
      indexes.push(Object.freeze({ name: row.indexName, column: row.columns[0]!, unique: row.isUnique }));
    }

    const primaryKeySet = new Set(primaryKey);
    const uniqueColumns = new Set(indexes.filter((index) => index.unique).map((index) => index.column));
    const indexedColumns = new Set(indexes.map((index) => index.column));
    const columnsWithFlags = columns.map((column) =>
      Object.freeze({
        ...column,
        primaryKey: primaryKeySet.has(column.columnName),
        unique: uniqueColumns.has(column.columnName),
        index: indexedColumns.has(column.columnName),
      })
    );

    const foreignKeys: ForeignKeyMetadata[] = (foreignKeysByTable.get(tableName) ?? []).map((row) => {
      const onDelete = ACTION_BY_CHAR[row.onDelete];
      const onUpdate = ACTION_BY_CHAR[row.onUpdate];
      return Object.freeze({
        column: row.columnName,
        referencesTable: row.referencesTable,
        referencesColumn: row.referencesColumn,
        ...(onDelete === undefined ? {} : { onDelete }),
        ...(onUpdate === undefined ? {} : { onUpdate }),
      });
    });

    const checks: CheckConstraintMetadata[] = (checksByTable.get(tableName) ?? []).map((row) =>
      Object.freeze({ column: row.columnName, expression: stripCheckWrapper(row.definition) })
    );

    const tableEnums = new Map<string, EnumTypeMetadata>();
    for (const column of columnsWithFlags) if (column.enum !== undefined) tableEnums.set(column.enum.name, column.enum);

    return Object.freeze({
      modelName: tableNameToModelName(tableName, modelNames),
      clientKey: tableNameToClientKey(tableName, modelNames),
      tableName,
      columns: Object.freeze(columnsWithFlags),
      primaryKey: Object.freeze(primaryKey),
      indexes: Object.freeze(indexes),
      foreignKeys: Object.freeze(foreignKeys),
      checks: Object.freeze(checks),
      enums: Object.freeze([...tableEnums.values()]),
    });
  }));
}
