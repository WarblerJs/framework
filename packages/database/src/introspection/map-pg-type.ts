import type { PgScalarType } from "../types/column.types";

export interface MappedPgType {
  readonly pgType: PgScalarType;
  readonly sqlType: string;
}

/** Raw catalog type facts for one column, as read from `information_schema.columns`. */
export interface ColumnTypeInfo {
  readonly dataType: string;
  readonly udtName: string;
  readonly characterMaximumLength: number | null;
  readonly numericPrecision: number | null;
  readonly numericScale: number | null;
  readonly datetimePrecision: number | null;
}

const SCALAR_BY_UDT: Readonly<Record<string, Readonly<{ pgType: PgScalarType; sqlName: string }>>> = {
  bool: { pgType: "boolean", sqlName: "BOOLEAN" },
  int2: { pgType: "smallint", sqlName: "SMALLINT" },
  int4: { pgType: "integer", sqlName: "INTEGER" },
  int8: { pgType: "bigint", sqlName: "BIGINT" },
  numeric: { pgType: "numeric", sqlName: "NUMERIC" },
  float4: { pgType: "real", sqlName: "REAL" },
  float8: { pgType: "double precision", sqlName: "DOUBLE PRECISION" },
  money: { pgType: "money", sqlName: "MONEY" },
  bpchar: { pgType: "char", sqlName: "CHAR" },
  varchar: { pgType: "varchar", sqlName: "VARCHAR" },
  text: { pgType: "text", sqlName: "TEXT" },
  bytea: { pgType: "bytea", sqlName: "BYTEA" },
  uuid: { pgType: "uuid", sqlName: "UUID" },
  json: { pgType: "json", sqlName: "JSON" },
  jsonb: { pgType: "jsonb", sqlName: "JSONB" },
  date: { pgType: "date", sqlName: "DATE" },
  time: { pgType: "time", sqlName: "TIME" },
  timetz: { pgType: "timetz", sqlName: "TIMETZ" },
  timestamp: { pgType: "timestamp", sqlName: "TIMESTAMP" },
  timestamptz: { pgType: "timestamptz", sqlName: "TIMESTAMPTZ" },
  interval: { pgType: "interval", sqlName: "INTERVAL" },
  inet: { pgType: "inet", sqlName: "INET" },
  cidr: { pgType: "cidr", sqlName: "CIDR" },
  macaddr: { pgType: "macaddr", sqlName: "MACADDR" },
  macaddr8: { pgType: "macaddr8", sqlName: "MACADDR8" },
  tsvector: { pgType: "tsvector", sqlName: "TSVECTOR" },
  tsquery: { pgType: "tsquery", sqlName: "TSQUERY" },
  xml: { pgType: "xml", sqlName: "XML" },
  bit: { pgType: "bit", sqlName: "BIT" },
  varbit: { pgType: "varbit", sqlName: "VARBIT" },
  point: { pgType: "point", sqlName: "POINT" },
  line: { pgType: "line", sqlName: "LINE" },
  lseg: { pgType: "lseg", sqlName: "LSEG" },
  box: { pgType: "box", sqlName: "BOX" },
  path: { pgType: "path", sqlName: "PATH" },
  polygon: { pgType: "polygon", sqlName: "POLYGON" },
  circle: { pgType: "circle", sqlName: "CIRCLE" },
  int4range: { pgType: "int4range", sqlName: "INT4RANGE" },
  int8range: { pgType: "int8range", sqlName: "INT8RANGE" },
  numrange: { pgType: "numrange", sqlName: "NUMRANGE" },
  tsrange: { pgType: "tsrange", sqlName: "TSRANGE" },
  tstzrange: { pgType: "tstzrange", sqlName: "TSTZRANGE" },
  daterange: { pgType: "daterange", sqlName: "DATERANGE" },
  int4multirange: { pgType: "int4multirange", sqlName: "INT4MULTIRANGE" },
  int8multirange: { pgType: "int8multirange", sqlName: "INT8MULTIRANGE" },
  nummultirange: { pgType: "nummultirange", sqlName: "NUMMULTIRANGE" },
  tsmultirange: { pgType: "tsmultirange", sqlName: "TSMULTIRANGE" },
  tstzmultirange: { pgType: "tstzmultirange", sqlName: "TSTZMULTIRANGE" },
  datemultirange: { pgType: "datemultirange", sqlName: "DATEMULTIRANGE" },
};

const SERIAL_BY_UDT: Readonly<Record<string, PgScalarType>> = {
  int2: "smallserial",
  int4: "serial",
  int8: "bigserial",
};

function withPrecision(sqlName: string, udtName: string, info: ColumnTypeInfo): string {
  if (udtName === "varchar" || udtName === "bpchar" || udtName === "bit" || udtName === "varbit") {
    return info.characterMaximumLength !== null ? `${sqlName}(${info.characterMaximumLength})` : sqlName;
  }
  if (udtName === "numeric") {
    return info.numericPrecision !== null ? `${sqlName}(${info.numericPrecision}, ${info.numericScale ?? 0})` : sqlName;
  }
  if (udtName === "time" || udtName === "timetz" || udtName === "timestamp" || udtName === "timestamptz") {
    return info.datetimePrecision !== null ? `${sqlName}(${info.datetimePrecision})` : sqlName;
  }
  return sqlName;
}

/**
 * Maps one introspected column's catalog type info back to a `PgScalarType` + reconstructed `sqlType`.
 * Enums (`dataType === "USER-DEFINED"`) resolve to `pgType: "enum"` with `sqlType` set to the enum's own
 * type name — the caller attaches ordered values separately. A column backed by a sequence default
 * (`nextval(...)`) maps to the matching `serial`/`bigserial`/`smallserial` type instead of its bare
 * integer type, mirroring how it would originally have been declared.
 */
export function mapPgType(info: ColumnTypeInfo, hasSequenceDefault: boolean): MappedPgType {
  const isArray = info.dataType === "ARRAY";
  const udtName = isArray ? info.udtName.replace(/^_/u, "") : info.udtName;

  if (info.dataType === "USER-DEFINED") {
    return Object.freeze({ pgType: "enum", sqlType: udtName });
  }

  const serialType = hasSequenceDefault && !isArray ? SERIAL_BY_UDT[udtName] : undefined;
  if (serialType !== undefined) {
    return Object.freeze({ pgType: serialType, sqlType: serialType.toUpperCase() });
  }

  const known = SCALAR_BY_UDT[udtName];
  if (known === undefined) {
    return Object.freeze({ pgType: "text", sqlType: udtName.toUpperCase() });
  }

  const sqlType = withPrecision(known.sqlName, udtName, info);
  return Object.freeze({ pgType: known.pgType, sqlType: isArray ? `${sqlType}[]` : sqlType });
}
