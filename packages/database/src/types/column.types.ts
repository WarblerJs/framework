import type { OnDeleteType } from "../columns/on-delete.types";
import type { OnUpdateType } from "../columns/on-update.types";
import type { PgDefaultTypes } from "../columns/pg-default";

/** Every base PostgreSQL scalar type name Warbler's column builders can produce. */
export type PgScalarType =
  | "boolean"
  | "smallint"
  | "integer"
  | "bigint"
  | "smallserial"
  | "serial"
  | "bigserial"
  | "numeric"
  | "real"
  | "double precision"
  | "money"
  | "char"
  | "varchar"
  | "text"
  | "bytea"
  | "uuid"
  | "json"
  | "jsonb"
  | "date"
  | "time"
  | "timetz"
  | "timestamp"
  | "timestamptz"
  | "interval"
  | "inet"
  | "cidr"
  | "macaddr"
  | "macaddr8"
  | "tsvector"
  | "tsquery"
  | "xml"
  | "bit"
  | "varbit"
  | "point"
  | "line"
  | "lseg"
  | "box"
  | "path"
  | "polygon"
  | "circle"
  | "int4range"
  | "int8range"
  | "numrange"
  | "tsrange"
  | "tstzrange"
  | "daterange"
  | "int4multirange"
  | "int8multirange"
  | "nummultirange"
  | "tsmultirange"
  | "tstzmultirange"
  | "datemultirange"
  | "enum";

/** A lazily-rendered CHECK constraint expression produced by `PgCheck.*`. */
export interface ColumnCheckExpression {
  readonly __wlbCheck: true;
  render(column: string): string;
}

/** A foreign key target, named by table/column rather than by object identity — a migration authoring a
 * column may target a table created by a different, earlier migration file, so there is no live
 * `ColumnBuilder` object to reference. */
export interface ColumnReference {
  readonly table: string;
  readonly column: string;
}

/** Column options every PostgreSQL type builder accepts, regardless of its specific type. */
export interface CommonColumnOptions {
  readonly nullable?: boolean;
  readonly default?: PgDefaultTypes | string | number | boolean;
  readonly unique?: boolean;
  readonly primaryKey?: boolean;
  readonly references?: ColumnReference;
  readonly onDelete?: OnDeleteType;
  readonly onUpdate?: OnUpdateType;
  readonly check?: ColumnCheckExpression;
  readonly identity?: boolean;
  readonly index?: boolean;
  readonly comment?: string;
}

/** The frozen descriptor produced by invoking any `PgTypes.*` builder. */
export interface ColumnBuilder extends CommonColumnOptions {
  readonly __wlbColumn: true;
  readonly pgType: PgScalarType;
  readonly sqlType: string;
  /** Present only for `PgTypes.Enum` columns; the `CREATE TYPE` name and its ordered values. */
  readonly enum?: Readonly<{ name: string; values: readonly string[] }>;
}

/** A bare (uninvoked) column builder function, e.g. `id: PgTypes.Bytea`. */
export type ColumnBuilderFactory = (options?: CommonColumnOptions) => ColumnBuilder;

/** A model field's raw value: either an invoked descriptor or a bare builder reference. */
export type ColumnValue = ColumnBuilder | ColumnBuilderFactory;
