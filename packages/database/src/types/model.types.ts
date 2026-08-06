import type { OnDeleteType } from "../columns/on-delete.types";
import type { PgDefaultTypes } from "../columns/pg-default";
import type { OnUpdateType } from "../columns/on-update.types";
import type { ColumnBuilder, PgScalarType } from "./column.types";

/** A column after bare builder references have been invoked, used by both introspection-derived and migration-authored column sets. */
export interface NormalizedColumn {
  readonly fieldName: string;
  readonly columnName: string;
  readonly builder: ColumnBuilder;
}

export interface IndexMetadata {
  readonly name: string;
  readonly column: string;
  readonly unique: boolean;
}

export interface ForeignKeyMetadata {
  readonly column: string;
  readonly referencesTable: string;
  readonly referencesColumn: string;
  readonly onDelete?: OnDeleteType;
  readonly onUpdate?: OnUpdateType;
}

export interface CheckConstraintMetadata {
  readonly column: string;
  readonly expression: string;
}

export interface EnumTypeMetadata {
  readonly name: string;
  readonly values: readonly string[];
}

/** A default value already fully expressed as valid SQL (as Postgres itself serializes `column_default`), emitted verbatim rather than quoted as a literal. */
export interface RawSqlDefault {
  readonly raw: string;
}

export interface ColumnMetadata {
  readonly fieldName: string;
  readonly columnName: string;
  readonly pgType: PgScalarType;
  readonly sqlType: string;
  readonly nullable: boolean;
  readonly default?: PgDefaultTypes | string | number | boolean | RawSqlDefault;
  readonly unique: boolean;
  readonly primaryKey: boolean;
  readonly identity: boolean;
  readonly index: boolean;
  readonly comment?: string;
  readonly enum?: EnumTypeMetadata;
}

/** The fully resolved, immutable description of one table, as introspected live from PostgreSQL. */
export interface TableMetadata {
  readonly modelName: string;
  readonly clientKey: string;
  readonly tableName: string;
  readonly columns: readonly ColumnMetadata[];
  readonly primaryKey: readonly string[];
  readonly indexes: readonly IndexMetadata[];
  readonly foreignKeys: readonly ForeignKeyMetadata[];
  readonly checks: readonly CheckConstraintMetadata[];
  readonly enums: readonly EnumTypeMetadata[];
}
