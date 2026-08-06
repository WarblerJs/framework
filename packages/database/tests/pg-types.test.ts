import { describe, expect, test } from "bun:test";
import { PgTypes } from "../src/columns/pg-types";

describe("PgTypes", () => {
  test("compact and object syntax produce identical metadata", () => {
    const compact = PgTypes.VarChar(50);
    const object = PgTypes.VarChar({ length: 50 });
    expect(compact).toEqual(object);
  });

  test("compact and object syntax agree for two-argument builders", () => {
    const compact = PgTypes.Numeric(7, 3);
    const object = PgTypes.Numeric({ precision: 7, scale: 3 });
    expect(compact).toEqual(object);
  });

  test("bare (uninvoked) builders resolve identically to a zero-argument call", () => {
    expect(PgTypes.Bytea()).toEqual(PgTypes.Bytea());
    expect(typeof PgTypes.Bytea).toBe("function");
  });

  test("carries every common column option through to the descriptor", () => {
    const column = PgTypes.Integer({
      nullable: false,
      default: 0,
      unique: false,
      primaryKey: false,
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
      identity: false,
      index: true,
      comment: "Role",
    });
    expect(column.__wlbColumn).toBe(true);
    expect(column.pgType).toBe("integer");
    expect(column.sqlType).toBe("INTEGER");
    expect(column.index).toBe(true);
    expect(column.comment).toBe("Role");
  });

  test("defaults length/precision when omitted", () => {
    expect(PgTypes.VarChar().sqlType).toBe("VARCHAR(255)");
    expect(PgTypes.Numeric().sqlType).toBe("NUMERIC");
    expect(PgTypes.Numeric(5).sqlType).toBe("NUMERIC(5, 0)");
  });

  test("Array wraps another builder's SQL type", () => {
    const column = PgTypes.Array(PgTypes.Text());
    expect(column.sqlType).toBe("TEXT[]");
    expect(column.pgType).toBe("text");
  });

  test("Enum carries its type name and ordered values", () => {
    const column = PgTypes.Enum("status", ["active", "inactive"]);
    expect(column.sqlType).toBe("status");
    expect(column.pgType).toBe("enum");
    expect(column.enum).toEqual({ name: "status", values: ["active", "inactive"] });
  });

  test("every invocation returns a frozen descriptor", () => {
    expect(Object.isFrozen(PgTypes.Uuid())).toBe(true);
  });
});
