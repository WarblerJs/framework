import type {
  ColumnBuilder,
  CommonColumnOptions,
  PgScalarType,
} from "../types/column.types";

type LengthOptions = CommonColumnOptions & { readonly length?: number };
type PrecisionOptions = CommonColumnOptions & { readonly precision?: number };
type NumericOptions = CommonColumnOptions & { readonly precision?: number; readonly scale?: number };

const createColumn = (
  pgType: PgScalarType,
  sqlType: string,
  options: CommonColumnOptions,
  enumDefinition?: ColumnBuilder["enum"],
): ColumnBuilder =>
  Object.freeze({
    __wlbColumn: true,
    pgType,
    sqlType,
    ...options,
    ...(enumDefinition === undefined ? {} : { enum: enumDefinition }),
  });

const splitLength = (
  argOrOptions: number | LengthOptions | undefined,
  fallback: number | undefined,
): Readonly<{ length: number | undefined; rest: CommonColumnOptions }> => {
  if (typeof argOrOptions === "number") return Object.freeze({ length: argOrOptions, rest: {} });
  const { length, ...rest } = argOrOptions ?? {};
  return Object.freeze({ length: length ?? fallback, rest });
};

const splitPrecision = (
  argOrOptions: number | PrecisionOptions | undefined,
): Readonly<{ precision: number | undefined; rest: CommonColumnOptions }> => {
  if (typeof argOrOptions === "number") return Object.freeze({ precision: argOrOptions, rest: {} });
  const { precision, ...rest } = argOrOptions ?? {};
  return Object.freeze({ precision, rest });
};

/** A type builder taking no type-specific arguments, only `CommonColumnOptions`. */
const simple = (pgType: PgScalarType, sqlName: string) =>
  (options: CommonColumnOptions = {}): ColumnBuilder => createColumn(pgType, sqlName, options);

/** A type builder whose only type-specific argument is a required length, e.g. `VARCHAR(n)`. */
const withLength = (pgType: PgScalarType, sqlName: string, fallback: number) =>
  (argOrOptions?: number | LengthOptions): ColumnBuilder => {
    const { length, rest } = splitLength(argOrOptions, fallback);
    return createColumn(pgType, `${sqlName}(${length})`, rest);
  };

/** A type builder whose only type-specific argument is an optional length, e.g. `VARBIT` / `VARBIT(n)`. */
const withOptionalLength = (pgType: PgScalarType, sqlName: string) =>
  (argOrOptions?: number | LengthOptions): ColumnBuilder => {
    const { length, rest } = splitLength(argOrOptions, undefined);
    return createColumn(pgType, length === undefined ? sqlName : `${sqlName}(${length})`, rest);
  };

/** A type builder whose only type-specific argument is an optional fractional-seconds precision. */
const withOptionalPrecision = (pgType: PgScalarType, sqlName: string) =>
  (argOrOptions?: number | PrecisionOptions): ColumnBuilder => {
    const { precision, rest } = splitPrecision(argOrOptions);
    return createColumn(pgType, precision === undefined ? sqlName : `${sqlName}(${precision})`, rest);
  };

/** `NUMERIC`/`DECIMAL`: the one builder with two positional compact args, precision and scale. */
const numeric = (pgType: PgScalarType) =>
  (precisionOrOptions?: number | NumericOptions, scaleArg?: number): ColumnBuilder => {
    if (typeof precisionOrOptions === "number") {
      return createColumn(pgType, `NUMERIC(${precisionOrOptions}, ${scaleArg ?? 0})`, {});
    }
    const { precision, scale, ...rest } = precisionOrOptions ?? {};
    return createColumn(pgType, precision === undefined ? "NUMERIC" : `NUMERIC(${precision}, ${scale ?? 0})`, rest);
  };

/** Every supported PostgreSQL column type builder. Compact and object syntax always funnel through `createColumn`, so both produce identical metadata. */
export const PgTypes = Object.freeze({
  // Boolean
  Boolean: simple("boolean", "BOOLEAN"),

  // Integer
  SmallInt: simple("smallint", "SMALLINT"),
  Integer: simple("integer", "INTEGER"),
  BigInt: simple("bigint", "BIGINT"),

  // Serial
  SmallSerial: simple("smallserial", "SMALLSERIAL"),
  Serial: simple("serial", "SERIAL"),
  BigSerial: simple("bigserial", "BIGSERIAL"),

  // Numeric
  Numeric: numeric("numeric"),
  Decimal: numeric("numeric"),
  Real: simple("real", "REAL"),
  DoublePrecision: simple("double precision", "DOUBLE PRECISION"),
  Money: simple("money", "MONEY"),

  // Character
  Char: withLength("char", "CHAR", 1),
  VarChar: withLength("varchar", "VARCHAR", 255),
  Text: simple("text", "TEXT"),

  // Binary
  Bytea: simple("bytea", "BYTEA"),

  // UUID
  Uuid: simple("uuid", "UUID"),

  // JSON
  Json: simple("json", "JSON"),
  Jsonb: simple("jsonb", "JSONB"),

  // Date & Time
  Date: simple("date", "DATE"),
  Time: withOptionalPrecision("time", "TIME"),
  TimeTz: withOptionalPrecision("timetz", "TIMETZ"),
  Timestamp: withOptionalPrecision("timestamp", "TIMESTAMP"),
  TimestampTz: withOptionalPrecision("timestamptz", "TIMESTAMPTZ"),
  Interval: simple("interval", "INTERVAL"),

  // Network
  Inet: simple("inet", "INET"),
  Cidr: simple("cidr", "CIDR"),
  MacAddr: simple("macaddr", "MACADDR"),
  MacAddr8: simple("macaddr8", "MACADDR8"),

  // Full Text
  TsVector: simple("tsvector", "TSVECTOR"),
  TsQuery: simple("tsquery", "TSQUERY"),

  // XML
  Xml: simple("xml", "XML"),

  // Bit
  Bit: withLength("bit", "BIT", 1),
  VarBit: withOptionalLength("varbit", "VARBIT"),

  // Geometric
  Point: simple("point", "POINT"),
  Line: simple("line", "LINE"),
  Lseg: simple("lseg", "LSEG"),
  Box: simple("box", "BOX"),
  Path: simple("path", "PATH"),
  Polygon: simple("polygon", "POLYGON"),
  Circle: simple("circle", "CIRCLE"),

  // Range
  Int4Range: simple("int4range", "INT4RANGE"),
  Int8Range: simple("int8range", "INT8RANGE"),
  NumRange: simple("numrange", "NUMRANGE"),
  TsRange: simple("tsrange", "TSRANGE"),
  TstzRange: simple("tstzrange", "TSTZRANGE"),
  DateRange: simple("daterange", "DATERANGE"),

  // Multirange
  Int4MultiRange: simple("int4multirange", "INT4MULTIRANGE"),
  Int8MultiRange: simple("int8multirange", "INT8MULTIRANGE"),
  NumMultiRange: simple("nummultirange", "NUMMULTIRANGE"),
  TsMultiRange: simple("tsmultirange", "TSMULTIRANGE"),
  TstzMultiRange: simple("tstzmultirange", "TSTZMULTIRANGE"),
  DateMultiRange: simple("datemultirange", "DATEMULTIRANGE"),

  /** Wraps another column builder as a PostgreSQL array, e.g. `PgTypes.Array(PgTypes.Text())`. */
  Array: (item: ColumnBuilder, options: CommonColumnOptions = {}): ColumnBuilder =>
    createColumn(item.pgType, `${item.sqlType}[]`, options, item.enum),

  /** Declares a named PostgreSQL enum type. Emits a `CREATE TYPE ... AS ENUM (...)` alongside the owning table. */
  Enum: (name: string, values: readonly string[], options: CommonColumnOptions = {}): ColumnBuilder =>
    createColumn("enum", name, options, Object.freeze({ name, values: Object.freeze([...values]) })),
});
