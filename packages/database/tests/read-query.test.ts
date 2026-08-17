import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { DatabaseQueryError, DatabaseRecordNotFoundError } from "../src/errors";
import {
  executeCount,
  executeFindFirst,
  executeFindFirstOrThrow,
  executeFindMany,
  executeFindUnique,
  executeFindUniqueOrThrow,
  type RuntimeReadSchema,
} from "../src/runtime/read-query";

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
      relations: Object.freeze([
        Object.freeze({ field: "posts", kind: "many", target: "Post", localColumn: "id", foreignColumn: "user_id" }),
      ]),
    }),
    Post: Object.freeze({
      name: "Post",
      table: "posts",
      defaultOrderColumn: "id",
      columns: Object.freeze([
        Object.freeze({ field: "id", column: "id", kind: "string", nullable: false, unique: false, primaryKey: true }),
        Object.freeze({ field: "userId", column: "user_id", kind: "string", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "likes", column: "likes", kind: "number", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "title", column: "title", kind: "string", nullable: false, unique: false, primaryKey: false }),
      ]),
      relations: Object.freeze([
        Object.freeze({ field: "user", kind: "one", target: "User", localColumn: "user_id", foreignColumn: "id" }),
      ]),
    }),
  }),
});

const user = schema.models.User!;

describe("read query compiler", () => {
  test("findUnique uses query-object where and rejects non-unique or ambiguous selectors", async () => {
    const sql = createFakeSql([{ id: "u1" }]);
    await expect(executeFindUnique(sql, schema, user, { where: { id: "u1" } })).resolves.toEqual({ id: "u1" });
    expect(sql.queries[0]!.sql).toContain('WHERE "wq0"."id" = $1');
    expect(sql.queries[0]!.params).toEqual(["u1"]);

    await expect(executeFindUnique(createFakeSql(), schema, user, { where: {} })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindUnique(createFakeSql(), schema, user, { where: { age: 3 } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindUnique(createFakeSql(), schema, user, { where: { id: "u1", email: "a@example.com" } })).rejects.toThrow(DatabaseQueryError);
  });

  test("orThrow methods share query paths and throw DatabaseRecordNotFoundError", async () => {
    await expect(executeFindUniqueOrThrow(createFakeSql(), schema, user, { where: { email: "none@example.com" } }))
      .rejects.toThrow(DatabaseRecordNotFoundError);
    await expect(executeFindFirstOrThrow(createFakeSql(), schema, user, { where: { email: "none@example.com" } }))
      .rejects.toThrow(DatabaseRecordNotFoundError);
  });

  test("findFirst compiles scalar filters, nulls, logical filters, ordering, and narrow select", async () => {
    const sql = createFakeSql([]);
    await executeFindFirst(sql, schema, user, {
      select: { id: true },
      where: {
        email: { contains: "@example.com" },
        age: null,
        AND: [{ createdAt: { gt: new Date("2026-01-01T00:00:00Z") } }],
      },
      orderBy: { createdAt: "desc" },
    });

    const query = sql.queries[0]!;
    expect(query.sql).toStartWith('SELECT "wq0"."id" AS "id" FROM "users" AS "wq0"');
    expect(query.sql).toContain('"wq0"."email" LIKE $1');
    expect(query.sql).toContain('"wq0"."age" IS NULL');
    expect(query.sql).toContain('"wq0"."created_at" > $2');
    expect(query.sql).toContain('ORDER BY "wq0"."created_at" DESC LIMIT 1');
    expect(query.params[0]).toBe("%@example.com%");
  });

  test("findMany supports relation filters, relation select without N+1, take, skip, and cursor", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, user, {
      where: { posts: { some: { likes: { gt: 100 } } } },
      select: {
        id: true,
        posts: {
          where: { title: { startsWith: "Hello" } },
          select: { id: true, title: true },
          orderBy: { title: "asc" },
          take: 5,
          skip: 1,
        },
      },
      cursor: { id: "u1" },
      orderBy: [{ id: "asc" }],
      take: 10,
      skip: 2,
    });

    const query = sql.queries[0]!;
    expect(sql.queries).toHaveLength(1);
    expect(query.sql).toContain("EXISTS (SELECT 1 FROM \"posts\"");
    expect(query.sql).toContain("json_agg(row_to_json");
    expect(query.sql).toContain('"wq0"."id" > $');
    expect(query.sql).toContain("LIMIT 10 OFFSET 2");
  });

  test("count reuses the shared where compiler", async () => {
    const sql = createFakeSql([{ count: 7 }]);
    await expect(executeCount(sql, schema, user, { where: { active: true } })).resolves.toBe(7);
    expect(sql.queries[0]!.sql).toBe('SELECT count(*)::int AS "count" FROM "users" AS "wq0" WHERE "wq0"."active" = $1');
  });

  test("rejects explicit undefined, invalid operators, unknown fields, and malformed pagination", async () => {
    await expect(executeFindMany(createFakeSql(), schema, user, { where: { id: undefined } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { where: { age: { contains: "x" } } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { where: { nope: 1 } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { orderBy: { nope: "asc" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { take: 1.5 })).rejects.toThrow(DatabaseQueryError);
  });
});
