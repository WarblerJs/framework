export const PgTypes = {
    // Boolean
    Boolean : 'boolean',
  
    // Integer
    SmallInt : 'smallint',
    Integer : 'integer',
    BigInt : 'bigint',
  
    // Serial
    SmallSerial : 'smallserial',
    Serial : 'serial',
    BigSerial : 'bigserial',
  
    // Numeric
    Decimal : 'decimal',
    Numeric : (s=5,e=2) => {
        return `NUMERIC(${s}, ${e})`
    },
    Real : 'real',
    DoublePrecision : 'double precision',
    Money : 'money',
  
    // Character
    Char : 'char',
    VarChar : (num = 50) => {
        return ` TEXT, CONSTRAINT chk_username_length CHECK (length(username) <= ${num})`
    },
    Text : 'text',
  
    // Binary
    Bytea : 'bytea',
  
    // UUID
    Uuid : 'uuid',
  
    // JSON
    Json : 'json',
    Jsonb : 'jsonb',
  
    // Date & Time
    Date : 'date',
    Time : 'time',
    TimeTz : 'timetz',
    Timestamp : 'timestamp',
    TimestampTz : 'timestamptz',
    Interval : 'interval',
  
    // Network
    Inet : 'inet',
    Cidr : 'cidr',
    MacAddr : 'macaddr',
    MacAddr8 : 'macaddr8',
  
    // Full Text
    TsVector : 'tsvector',
    TsQuery : 'tsquery',
  
    // XML
    Xml : 'xml',
  
    // Bit
    Bit : 'bit',
    VarBit : 'varbit',
  
    // Geometric
    Point : 'point',
    Line : 'line',
    Lseg : 'lseg',
    Box : 'box',
    Path : 'path',
    Polygon : 'polygon',
    Circle : 'circle',
  
    // Range
    Int4Range : 'int4range',
    Int8Range : 'int8range',
    NumRange : 'numrange',
    TsRange : 'tsrange',
    TstzRange : 'tstzrange',
    DateRange : 'daterange',
  
    // Multi Range
    Int4MultiRange : 'int4multirange',
    Int8MultiRange : 'int8multirange',
    NumMultiRange : 'nummultirange',
    TsMultiRange : 'tsmultirange',
    TstzMultiRange : 'tstzmultirange',
    DateMultiRange : 'datemultirange',
  
    // Arrays
    Array : 'array',
  
    // Enum
    Enum : 'enum',
}

export type PgT =
| 'boolean'
| 'smallint'
| 'integer'
| 'bigint'
| 'smallserial'
| 'serial'
| 'bigserial'
| 'decimal'
| 'numeric'
| 'real'
| 'double precision'
| 'money'
| 'char'
| 'varchar'
| 'text'
| 'bytea'
| 'uuid'
| 'json'
| 'jsonb'
| 'date'
| 'time'
| 'timetz'
| 'timestamp'
| 'timestamptz'
| 'interval'
| 'inet'
| 'cidr'
| 'macaddr'
| 'macaddr8'
| 'tsvector'
| 'tsquery'
| 'xml'
| 'bit'
| 'varbit'
| 'point'
| 'line'
| 'lseg'
| 'box'
| 'path'
| 'polygon'
| 'circle'
| 'int4range'
| 'int8range'
| 'numrange'
| 'tsrange'
| 'tstzrange'
| 'daterange'
| 'int4multirange'
| 'int8multirange'
| 'nummultirange'
| 'tsmultirange'
| 'tstzmultirange'
| 'datemultirange'
| 'array'
| 'enum';