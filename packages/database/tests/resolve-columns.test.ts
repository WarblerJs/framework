import { describe, expect, test } from "bun:test";
import { PgDefault } from "../src/columns/pg-default";
import { resolveColumns } from "../src/columns/resolve-columns";
import { PgTypes } from "../src/columns/pg-types";
import { DatabaseCompileError } from "../src/errors";

describe("resolveColumns", () => {
  test("invokes bare builder references and derives snake_case column names", () => {
    const columns = resolveColumns("createTable(users)", {
      id: PgTypes.Bytea,
      passwordHash: PgTypes.Text({ nullable: false }),
    });
    expect(columns).toHaveLength(2);
    expect(columns[0]).toMatchObject({ fieldName: "id", columnName: "id" });
    expect(columns[0]?.builder.__wlbColumn).toBe(true);
    expect(columns[1]).toMatchObject({ fieldName: "passwordHash", columnName: "password_hash" });
  });

  test("preserves declaration order", () => {
    const columns = resolveColumns("createTable(users)", {
      zeta: PgTypes.Text(),
      alpha: PgTypes.Text(),
    });
    expect(columns.map((column) => column.fieldName)).toEqual(["zeta", "alpha"]);
  });

  test("accepts already-invoked builders alongside bare ones", () => {
    const columns = resolveColumns("createTable(users)", {
      id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
      uuid: PgTypes.Uuid,
    });
    expect(columns[0]?.builder.primaryKey).toBe(true);
    expect(columns[1]?.builder.__wlbColumn).toBe(true);
  });

  test("rejects an empty column set", () => {
    expect(() => resolveColumns("createTable(empty)", {})).toThrow(DatabaseCompileError);
  });

  test("rejects a field that is neither a builder nor a builder factory", () => {
    expect(() => resolveColumns("createTable(users)", { id: "not-a-builder" })).toThrow(DatabaseCompileError);
  });
});
