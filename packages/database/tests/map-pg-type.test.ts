import { describe, expect, test } from "bun:test";
import { mapPgType, type ColumnTypeInfo } from "../src/introspection/map-pg-type";

const base: ColumnTypeInfo = {
  dataType: "",
  udtName: "",
  characterMaximumLength: null,
  numericPrecision: null,
  numericScale: null,
  datetimePrecision: null,
};

describe("mapPgType", () => {
  test("maps simple scalar types", () => {
    expect(mapPgType({ ...base, dataType: "boolean", udtName: "bool" }, false)).toEqual({ pgType: "boolean", sqlType: "BOOLEAN" });
    expect(mapPgType({ ...base, dataType: "text", udtName: "text" }, false)).toEqual({ pgType: "text", sqlType: "TEXT" });
    expect(mapPgType({ ...base, dataType: "uuid", udtName: "uuid" }, false)).toEqual({ pgType: "uuid", sqlType: "UUID" });
  });

  test("reconstructs varchar length", () => {
    expect(mapPgType({ ...base, dataType: "character varying", udtName: "varchar", characterMaximumLength: 255 }, false))
      .toEqual({ pgType: "varchar", sqlType: "VARCHAR(255)" });
  });

  test("reconstructs numeric precision/scale", () => {
    expect(mapPgType({ ...base, dataType: "numeric", udtName: "numeric", numericPrecision: 7, numericScale: 3 }, false))
      .toEqual({ pgType: "numeric", sqlType: "NUMERIC(7, 3)" });
  });

  test("reconstructs timestamp precision", () => {
    expect(mapPgType({ ...base, dataType: "timestamp without time zone", udtName: "timestamp", datetimePrecision: 3 }, false))
      .toEqual({ pgType: "timestamp", sqlType: "TIMESTAMP(3)" });
  });

  test("detects serial columns from a sequence default", () => {
    expect(mapPgType({ ...base, dataType: "integer", udtName: "int4" }, true)).toEqual({ pgType: "serial", sqlType: "SERIAL" });
    expect(mapPgType({ ...base, dataType: "bigint", udtName: "int8" }, true)).toEqual({ pgType: "bigserial", sqlType: "BIGSERIAL" });
  });

  test("does not treat a plain integer with a sequence default as serial when it's an array", () => {
    expect(mapPgType({ ...base, dataType: "ARRAY", udtName: "_int4" }, true).pgType).toBe("integer");
  });

  test("detects arrays and appends []", () => {
    expect(mapPgType({ ...base, dataType: "ARRAY", udtName: "_text" }, false)).toEqual({ pgType: "text", sqlType: "TEXT[]" });
  });

  test("maps enums to pgType 'enum' with sqlType set to the enum's own name", () => {
    expect(mapPgType({ ...base, dataType: "USER-DEFINED", udtName: "status" }, false)).toEqual({ pgType: "enum", sqlType: "status" });
  });

  test("falls back to an opaque text passthrough for unknown catalog types", () => {
    expect(mapPgType({ ...base, dataType: "some_future_type", udtName: "some_future_type" }, false))
      .toEqual({ pgType: "text", sqlType: "SOME_FUTURE_TYPE" });
  });
});
