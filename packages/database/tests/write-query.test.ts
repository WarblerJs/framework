import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { DatabaseQueryError, DatabaseRecordNotFoundError } from "../src/errors";
import {
  executeCreate,
  executeCreateMany,
  executeCreateManyAndReturn,
  executeDelete,
  executeDeleteMany,
  executeUpdate,
  executeUpdateMany,
  executeUpdateManyAndReturn,
  executeUpsert,
} from "../src/runtime/write-query";
import type { RuntimeReadSchema } from "../src/runtime/read-query";

function createFakeSql(rows: readonly unknown[] = []): SQL & { readonly queries: readonly { sql: string; params: readonly unknown[] }[] } {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  return {
    get queries() { return queries; },
    unsafe: async (sql: string, params?: readonly unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return [...rows];
    },
  } as unknown as SQL & { readonly queries: readonly { sql: string; params: readonly unknown[] }[] };
}

const schema: RuntimeReadSchema = Object.freeze({
  models: Object.freeze({
    User: Object.freeze({
      name: "User",
      table: "users",
      defaultOrderColumn: "id",
      columns: Object.freeze([
        Object.freeze({ field: "id", column: "id", kind: "string", nullable: false, unique: false, primaryKey: true }),
        Object.freeze({ field: "email", column: "email", kind: "string", nullable: false, unique: true, primaryKey: false }),
        Object.freeze({ field: "age", column: "age", kind: "number", nullable: true, unique: false, primaryKey: false }),
        Object.freeze({ field: "active", column: "active", kind: "boolean", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "createdAt", column: "created_at", kind: "date", nullable: false, unique: false, primaryKey: false }),
      ]),
      relations: Object.freeze([]),
    }),
  }),
});

const user = schema.models.User!;

describe("write query compiler", () => {
  test("create inserts parameterized data and returns selected columns", async () => {
    const sql = createFakeSql([{ id: "u1", email: "a@example.com" }]);
    const row = await executeCreate(sql, schema, user, {
      data: { email: 'a@example.com"; DROP TABLE users; --', active: true },
      select: { id: true, email: true },
    });

    expect(row).toEqual({ id: "u1", email: "a@example.com" });
    expect(sql.queries[0]!.sql).toBe('INSERT INTO "users" ("email", "active") VALUES ($1, $2) RETURNING "id" AS "id", "email" AS "email"');
    expect(sql.queries[0]!.params).toEqual(['a@example.com"; DROP TABLE users; --', true]);
  });

  test("create supports DEFAULT VALUES", async () => {
    const sql = createFakeSql([{ id: "u1" }]);
    await executeCreate(sql, schema, user, { data: {} });

    expect(sql.queries[0]!.sql).toBe('INSERT INTO "users" DEFAULT VALUES RETURNING "id" AS "id", "email" AS "email", "age" AS "age", "active" AS "active", "created_at" AS "createdAt"');
    expect(sql.queries[0]!.params).toEqual([]);
  });

  test("createMany counts inserted rows and supports skipDuplicates", async () => {
    const sql = createFakeSql([{ count: 2 }]);
    await expect(executeCreateMany(sql, schema, user, {
      data: [
        { email: "a@example.com", active: true },
        { email: "b@example.com", age: 32, active: false },
      ],
      skipDuplicates: true,
    })).resolves.toEqual({ count: 2 });

    expect(sql.queries[0]!.sql).toContain('INSERT INTO "users" ("email", "active", "age") VALUES ($1, $2, DEFAULT), ($3, $4, $5) ON CONFLICT DO NOTHING RETURNING 1');
    expect(sql.queries[0]!.params).toEqual(["a@example.com", true, "b@example.com", false, 32]);
    await expect(executeCreateMany(createFakeSql(), schema, user, { data: [] })).resolves.toEqual({ count: 0 });
  });

  test("createManyAndReturn emits a multi-row RETURNING insert", async () => {
    const sql = createFakeSql([{ id: "u1" }]);
    await executeCreateManyAndReturn(sql, schema, user, {
      data: [{ email: "a@example.com", active: true }],
      select: { id: true },
    });

    expect(sql.queries[0]!.sql).toBe('INSERT INTO "users" ("email", "active") VALUES ($1, $2) RETURNING "id" AS "id"');
    expect(sql.queries[0]!.params).toEqual(["a@example.com", true]);
  });

  test("update requires a unique selector, supports atomic operators, and uses one parameter sequence", async () => {
    const sql = createFakeSql([{ id: "u1", age: 11 }]);
    await executeUpdate(sql, schema, user, {
      where: { id: "u1" },
      data: { age: { increment: 2 }, email: { set: "new@example.com" } },
      select: { id: true, age: true },
    });

    expect(sql.queries[0]!.sql).toBe('UPDATE "users" SET "age" = "age" + $1, "email" = $2 WHERE "id" = $3 RETURNING "id" AS "id", "age" AS "age"');
    expect(sql.queries[0]!.params).toEqual([2, "new@example.com", "u1"]);
    await expect(executeUpdate(createFakeSql(), schema, user, { where: { age: 1 }, data: { email: "x@example.com" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeUpdate(createFakeSql(), schema, user, { where: { id: "missing" }, data: { email: "x@example.com" } })).rejects.toThrow(DatabaseRecordNotFoundError);
  });

  test("updateMany requires a non-empty where and returns affected count", async () => {
    const sql = createFakeSql([{ count: 3 }]);
    await expect(executeUpdateMany(sql, schema, user, {
      where: { email: { contains: "@example.com" }, active: true },
      data: { active: false },
    })).resolves.toEqual({ count: 3 });

    expect(sql.queries[0]!.sql).toContain('UPDATE "users" AS "wq0" SET "active" = $1 WHERE "wq0"."email" LIKE $2 AND "wq0"."active" = $3 RETURNING 1');
    expect(sql.queries[0]!.params).toEqual([false, "%@example.com%", true]);
    await expect(executeUpdateMany(createFakeSql(), schema, user, { where: {}, data: { active: false } })).rejects.toThrow(DatabaseQueryError);
  });

  test("updateManyAndReturn returns selected rows", async () => {
    const sql = createFakeSql([{ id: "u1" }]);
    await executeUpdateManyAndReturn(sql, schema, user, {
      where: { age: { gte: 18 } },
      data: { active: true },
      select: { id: true },
    });

    expect(sql.queries[0]!.sql).toBe('UPDATE "users" AS "wq0" SET "active" = $1 WHERE "wq0"."age" >= $2 RETURNING "id" AS "id"');
    expect(sql.queries[0]!.params).toEqual([true, 18]);
  });

  test("upsert uses ON CONFLICT and preserves distinct placeholders across insert and update", async () => {
    const sql = createFakeSql([{ id: "u1" }]);
    await executeUpsert(sql, schema, user, {
      where: { email: "a@example.com" },
      create: { active: true },
      update: { age: { increment: 1 }, active: false },
      select: { id: true },
    });

    expect(sql.queries[0]!.sql).toBe('INSERT INTO "users" ("active", "email") VALUES ($1, $2) ON CONFLICT ("email") DO UPDATE SET "age" = "age" + $3, "active" = $4 RETURNING "id" AS "id"');
    expect(sql.queries[0]!.params).toEqual([true, "a@example.com", 1, false]);
  });

  test("delete requires a unique selector and deleteMany protects against mass deletion", async () => {
    const deleteSql = createFakeSql([{ id: "u1" }]);
    await executeDelete(deleteSql, schema, user, { where: { email: "a@example.com" }, select: { id: true } });
    expect(deleteSql.queries[0]!.sql).toBe('DELETE FROM "users" WHERE "email" = $1 RETURNING "id" AS "id"');
    expect(deleteSql.queries[0]!.params).toEqual(["a@example.com"]);

    const deleteManySql = createFakeSql([{ count: 1 }]);
    await expect(executeDeleteMany(deleteManySql, schema, user, { where: { active: false } })).resolves.toEqual({ count: 1 });
    expect(deleteManySql.queries[0]!.sql).toContain('DELETE FROM "users" AS "wq0" WHERE "wq0"."active" = $1 RETURNING 1');
    await expect(executeDeleteMany(createFakeSql(), schema, user, { where: {} })).rejects.toThrow(DatabaseQueryError);
    await expect(executeDelete(createFakeSql(), schema, user, { where: { id: "missing" } })).rejects.toThrow(DatabaseRecordNotFoundError);
  });

  test("rejects explicit undefined, unknown fields, and invalid mutation operators", async () => {
    await expect(executeCreate(createFakeSql(), schema, user, { data: { email: undefined } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeCreate(createFakeSql(), schema, user, { data: { nope: "x" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeUpdate(createFakeSql(), schema, user, { where: { id: "u1" }, data: { email: { increment: 1 } } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeUpdate(createFakeSql(), schema, user, { where: { id: "u1" }, data: { email: { set: "x", increment: 1 } } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeCreate(createFakeSql(), schema, user, { data: { email: null } })).rejects.toThrow(DatabaseQueryError);
  });
});
