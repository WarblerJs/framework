import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { DatabaseQueryError, DatabaseRecordNotFoundError } from "../src/errors";
import {
  executeAggregate,
  executeCount,
  executeExists,
  executeFindFirst,
  executeFindFirstOrThrow,
  executeFindMany,
  executeFindUnique,
  executeFindUniqueOrThrow,
  executeGroupBy,
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
        Object.freeze({ field: "cost", column: "cost", kind: "number", nullable: true, unique: false, primaryKey: false }),
        Object.freeze({ field: "title", column: "title", kind: "string", nullable: false, unique: false, primaryKey: false }),
      ]),
      relations: Object.freeze([
        Object.freeze({ field: "user", kind: "one", target: "User", localColumn: "user_id", foreignColumn: "id" }),
      ]),
    }),
  }),
});

const user = schema.models.User!;
const post = schema.models.Post!;

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

  test("count supports selected field counts and preserves exact aliases", async () => {
    const sql = createFakeSql([{ __wlb_count_all: 3, __wlb_count_email: 3, __wlb_count_age: 2 }]);
    await expect(executeCount(sql, schema, user, {
      where: { active: true },
      select: { _all: true, email: true, age: true },
    })).resolves.toEqual({ _all: 3, email: 3, age: 2 });

    expect(sql.queries[0]!.sql).toBe('SELECT count(*)::int AS "__wlb_count_all", count("wq0"."email")::int AS "__wlb_count_email", count("wq0"."age")::int AS "__wlb_count_age" FROM "users" AS "wq0" WHERE "wq0"."active" = $1');
  });

  test("exists compiles to SELECT EXISTS and reuses relation-safe filters", async () => {
    const sql = createFakeSql([{ exists: true }]);
    await expect(executeExists(sql, schema, user, {
      where: { posts: { some: { likes: { gt: 10 } } } },
    })).resolves.toBe(true);

    const query = sql.queries[0]!;
    expect(query.sql).toStartWith('SELECT EXISTS (SELECT 1 FROM "users" AS "wq0" WHERE EXISTS (SELECT 1 FROM "posts" AS "wq1"');
    expect(query.sql).toContain('"wq1"."user_id" = "wq0"."id" AND "wq1"."likes" > $1');
    expect(query.params).toEqual([10]);
  });

  test("aggregate compiles requested operations without hydrating rows", async () => {
    const sql = createFakeSql([{
      __wlb_count_all: 2,
      __wlb_sum_likes: 30,
      __wlb_avg_likes: 15,
      __wlb_min_title: "A",
      __wlb_max_title: "Z",
    }]);

    await expect(executeAggregate(sql, schema, post, {
      where: { title: { contains: "guide" } },
      _count: true,
      _sum: { likes: true },
      _avg: { likes: true },
      _min: { title: true },
      _max: { title: true },
    })).resolves.toEqual({
      _count: 2,
      _sum: { likes: 30 },
      _avg: { likes: 15 },
      _min: { title: "A" },
      _max: { title: "Z" },
    });

    expect(sql.queries[0]!.sql).toBe('SELECT count(*)::int AS "__wlb_count_all", sum("wq0"."likes") AS "__wlb_sum_likes", avg("wq0"."likes") AS "__wlb_avg_likes", min("wq0"."title") AS "__wlb_min_title", max("wq0"."title") AS "__wlb_max_title" FROM "posts" AS "wq0" WHERE "wq0"."title" LIKE $1');
    expect(sql.queries[0]!.params).toEqual(["%guide%"]);
  });

  test("groupBy compiles grouped aggregates, having, aggregate ordering, and pagination", async () => {
    const sql = createFakeSql([{
      userId: "u1",
      title: "Guide",
      __wlb_count_id: 2,
      __wlb_sum_likes: 300,
      __wlb_avg_cost: "10.50",
    }]);

    await expect(executeGroupBy(sql, schema, post, {
      by: ["userId", "title"],
      where: { OR: [{ title: { startsWith: "Guide" } }, { likes: { gt: 100 } }] },
      _count: { id: true },
      _sum: { likes: true },
      _avg: { cost: true },
      having: { likes: { _sum: { gt: 200 } } },
      orderBy: [{ _sum: { likes: "desc" } }, { userId: "asc" }],
      take: 20,
      skip: 0,
    })).resolves.toEqual([{
      userId: "u1",
      title: "Guide",
      _count: { id: 2 },
      _sum: { likes: 300 },
      _avg: { cost: "10.50" },
    }]);

    const query = sql.queries[0]!;
    expect(query.sql).toBe('SELECT "wq0"."user_id" AS "userId", "wq0"."title" AS "title", count("wq0"."id")::int AS "__wlb_count_id", sum("wq0"."likes") AS "__wlb_sum_likes", avg("wq0"."cost") AS "__wlb_avg_cost" FROM "posts" AS "wq0" WHERE ("wq0"."title" LIKE $1 OR "wq0"."likes" > $2) GROUP BY "wq0"."user_id", "wq0"."title" HAVING sum("wq0"."likes") > $3 ORDER BY sum("wq0"."likes") DESC, "wq0"."user_id" ASC LIMIT 20 OFFSET 0');
    expect(query.params).toEqual(["Guide%", 100, 200]);
  });

  test("rejects explicit undefined, invalid operators, unknown fields, and malformed pagination", async () => {
    await expect(executeFindMany(createFakeSql(), schema, user, { where: { id: undefined } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { where: { age: { contains: "x" } } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { where: { nope: 1 } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { orderBy: { nope: "asc" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { take: 1.5 })).rejects.toThrow(DatabaseQueryError);
    await expect(executeAggregate(createFakeSql(), schema, user, { _sum: { email: true } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeGroupBy(createFakeSql(), schema, user, { by: [] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeGroupBy(createFakeSql(), schema, user, { by: ["active"], orderBy: { email: "asc" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeGroupBy(createFakeSql(), schema, user, { by: ["active"], take: 1.5 })).rejects.toThrow(DatabaseQueryError);
  });
});
