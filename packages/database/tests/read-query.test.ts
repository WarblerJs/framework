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
      primaryKeyFields: Object.freeze(["id"]),
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
      primaryKeyFields: Object.freeze(["id"]),
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
    Product: Object.freeze({
      name: "Product",
      table: "products",
      defaultOrderColumn: "id",
      primaryKeyFields: Object.freeze(["id"]),
      columns: Object.freeze([
        Object.freeze({ field: "id", column: "id", kind: "string", pgType: "uuid", nullable: false, unique: false, primaryKey: true }),
        Object.freeze({ field: "price", column: "price", kind: "number", pgType: "numeric", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "createdAt", column: "created_at", kind: "date", pgType: "timestamp", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "isActive", column: "is_active", kind: "boolean", pgType: "boolean", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "category", column: "category", kind: "string", pgType: "varchar", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "brand", column: "brand", kind: "string", pgType: "varchar", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "status", column: "status", kind: "string", pgType: "varchar", nullable: false, unique: false, primaryKey: false }),
        Object.freeze({ field: "rating", column: "rating", kind: "number", pgType: "numeric", nullable: true, unique: false, primaryKey: false }),
      ]),
      relations: Object.freeze([]),
    }),
  }),
});

const user = schema.models.User!;
const post = schema.models.Post!;
const product = schema.models.Product!;

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
      skip: 0,
    });

    const query = sql.queries[0]!;
    expect(sql.queries).toHaveLength(1);
    expect(query.sql).toContain("EXISTS (SELECT 1 FROM \"posts\"");
    expect(query.sql).toContain("json_agg(row_to_json");
    expect(query.sql).toContain('"wq0"."id" > $');
    expect(query.sql).toContain("LIMIT 10 OFFSET 0");
  });

  test("cursor preserves simple strict-after ASC behavior", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, user, {
      cursor: { id: "3" },
      orderBy: { id: "asc" },
      take: 3,
    });

    expect(sql.queries[0]!.sql).toBe('SELECT "wq0"."id" AS "id", "wq0"."email" AS "email", "wq0"."age" AS "age", "wq0"."active" AS "active", "wq0"."created_at" AS "createdAt" FROM "users" AS "wq0" WHERE ("wq0"."id" > $1) ORDER BY "wq0"."id" ASC LIMIT 3');
    expect(sql.queries[0]!.params).toEqual(["3"]);
  });

  test("cursor supports DESC without returning rows before the boundary", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, user, {
      cursor: { id: "6" },
      orderBy: { id: "desc" },
      take: 3,
    });

    expect(sql.queries[0]!.sql).toContain('WHERE ("wq0"."id" < $1) ORDER BY "wq0"."id" DESC LIMIT 3');
    expect(sql.queries[0]!.params).toEqual(["6"]);
  });

  test("cursor compiles compound keyset predicates for duplicate sort values", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, post, {
      where: { title: { startsWith: "Guide" } },
      cursor: { likes: 100, id: "p2" },
      orderBy: [{ likes: "asc" }, { id: "asc" }],
      take: 2,
      select: { id: true, likes: true },
    });

    expect(sql.queries[0]!.sql).toBe('SELECT "wq0"."id" AS "id", "wq0"."likes" AS "likes" FROM "posts" AS "wq0" WHERE "wq0"."title" LIKE $1 AND ("wq0"."likes" > $2 OR ("wq0"."likes" = $2 AND "wq0"."id" > $3)) ORDER BY "wq0"."likes" ASC, "wq0"."id" ASC LIMIT 2');
    expect(sql.queries[0]!.params).toEqual(["Guide%", 100, "p2"]);
  });

  test("cursor uses each orderBy direction in mixed ASC/DESC predicates", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, post, {
      cursor: { likes: 300, title: "A", id: "p9" },
      orderBy: [{ likes: "desc" }, { title: "asc" }, { id: "asc" }],
      take: 1,
    });

    expect(sql.queries[0]!.sql).toContain('WHERE ("wq0"."likes" < $1 OR ("wq0"."likes" = $1 AND "wq0"."title" > $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" > $3))');
    expect(sql.queries[0]!.sql).toContain('ORDER BY "wq0"."likes" DESC, "wq0"."title" ASC, "wq0"."id" ASC LIMIT 1');
    expect(sql.queries[0]!.params).toEqual([300, "A", "p9"]);
  });

  test("cursor preserves the reported mixed-direction boundary with timestamp precision", async () => {
    const sql = createFakeSql([]);
    const cursorCreatedAt = new Date("2026-08-19T08:11:52.256Z");
    await executeFindMany(sql, schema, product, {
      where: {
        isActive: true,
        OR: [{ category: "electronics" }, { category: "automotive" }],
      },
      cursor: {
        price: "4999.99",
        createdAt: cursorCreatedAt,
        id: "8ce695f9-1891-4385-9402-5ad615ce8708",
      },
      orderBy: [{ price: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, price: true, createdAt: true, isActive: true, category: true },
      take: 10,
    });

    expect(sql.queries[0]!.sql).toBe('SELECT "wq0"."id" AS "id", "wq0"."price" AS "price", "wq0"."created_at" AS "createdAt", "wq0"."is_active" AS "isActive", "wq0"."category" AS "category" FROM "products" AS "wq0" WHERE "wq0"."is_active" = $1 AND ("wq0"."category" = $2 OR "wq0"."category" = $3) AND ("wq0"."price" < $4 OR ("wq0"."price" = $4 AND date_trunc(\'milliseconds\', "wq0"."created_at") > $5) OR ("wq0"."price" = $4 AND date_trunc(\'milliseconds\', "wq0"."created_at") = $5 AND "wq0"."id" > $6)) ORDER BY "wq0"."price" DESC, date_trunc(\'milliseconds\', "wq0"."created_at") ASC, "wq0"."id" ASC LIMIT 10');
    expect(sql.queries[0]!.params).toEqual([true, "electronics", "automotive", "4999.99", cursorCreatedAt, "8ce695f9-1891-4385-9402-5ad615ce8708"]);
    expect(sql.queries[0]!.sql).not.toContain(">=");
    expect(sql.queries[0]!.sql).not.toContain("<=");
  });

  test("cursor compiles all two-field and three-field direction combinations", async () => {
    const cases = [
      {
        orderBy: [{ likes: "asc" }, { id: "asc" }],
        cursor: { likes: 10, id: "p2" },
        predicate: '("wq0"."likes" > $1 OR ("wq0"."likes" = $1 AND "wq0"."id" > $2))',
      },
      {
        orderBy: [{ likes: "desc" }, { id: "desc" }],
        cursor: { likes: 10, id: "p2" },
        predicate: '("wq0"."likes" < $1 OR ("wq0"."likes" = $1 AND "wq0"."id" < $2))',
      },
      {
        orderBy: [{ likes: "asc" }, { id: "desc" }],
        cursor: { likes: 10, id: "p2" },
        predicate: '("wq0"."likes" > $1 OR ("wq0"."likes" = $1 AND "wq0"."id" < $2))',
      },
      {
        orderBy: [{ likes: "desc" }, { id: "asc" }],
        cursor: { likes: 10, id: "p2" },
        predicate: '("wq0"."likes" < $1 OR ("wq0"."likes" = $1 AND "wq0"."id" > $2))',
      },
      {
        orderBy: [{ likes: "asc" }, { title: "asc" }, { id: "asc" }],
        cursor: { likes: 10, title: "A", id: "p2" },
        predicate: '("wq0"."likes" > $1 OR ("wq0"."likes" = $1 AND "wq0"."title" > $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" > $3))',
      },
      {
        orderBy: [{ likes: "desc" }, { title: "desc" }, { id: "desc" }],
        cursor: { likes: 10, title: "A", id: "p2" },
        predicate: '("wq0"."likes" < $1 OR ("wq0"."likes" = $1 AND "wq0"."title" < $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" < $3))',
      },
      {
        orderBy: [{ likes: "desc" }, { title: "asc" }, { id: "asc" }],
        cursor: { likes: 10, title: "A", id: "p2" },
        predicate: '("wq0"."likes" < $1 OR ("wq0"."likes" = $1 AND "wq0"."title" > $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" > $3))',
      },
      {
        orderBy: [{ likes: "asc" }, { title: "desc" }, { id: "asc" }],
        cursor: { likes: 10, title: "A", id: "p2" },
        predicate: '("wq0"."likes" > $1 OR ("wq0"."likes" = $1 AND "wq0"."title" < $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" > $3))',
      },
      {
        orderBy: [{ likes: "asc" }, { title: "asc" }, { id: "desc" }],
        cursor: { likes: 10, title: "A", id: "p2" },
        predicate: '("wq0"."likes" > $1 OR ("wq0"."likes" = $1 AND "wq0"."title" > $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" < $3))',
      },
      {
        orderBy: [{ likes: "desc" }, { title: "asc" }, { id: "desc" }],
        cursor: { likes: 10, title: "A", id: "p2" },
        predicate: '("wq0"."likes" < $1 OR ("wq0"."likes" = $1 AND "wq0"."title" > $2) OR ("wq0"."likes" = $1 AND "wq0"."title" = $2 AND "wq0"."id" < $3))',
      },
    ] as const;

    for (const item of cases) {
      const sql = createFakeSql([]);
      await executeFindMany(sql, schema, post, {
        cursor: item.cursor,
        orderBy: item.orderBy,
        take: 1,
        select: { id: true },
      });
      expect(sql.queries[0]!.sql).toContain(`WHERE ${item.predicate}`);
      expect(sql.queries[0]!.sql).not.toContain(">=");
      expect(sql.queries[0]!.sql).not.toContain("<=");
    }
  });

  test("distinct compiles projection-only scalar keys to plain PostgreSQL DISTINCT", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, product, {
      distinct: ["brand"],
      select: { brand: true },
      orderBy: { brand: "asc" },
      take: 3,
    });

    expect(sql.queries[0]!.sql).toBe('SELECT DISTINCT "wq0"."brand" AS "brand" FROM "products" AS "wq0" ORDER BY "wq0"."brand" ASC LIMIT 3');
    expect(sql.queries[0]!.sql).not.toContain("DISTINCT ON");
    expect(sql.queries[0]!.sql).not.toContain('"wq0"."id" ASC');
    expect(sql.queries[0]!.params).toEqual([]);
  });

  test("distinct supports compound projection-only keys with where, take, and skip on the distinct result", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, product, {
      where: { isActive: true },
      distinct: ["category", "brand"],
      select: { category: true, brand: true },
      orderBy: [{ category: "asc" }, { brand: "asc" }],
      take: 2,
      skip: 1,
    });

    expect(sql.queries[0]!.sql).toBe('SELECT DISTINCT "wq0"."category" AS "category", "wq0"."brand" AS "brand" FROM "products" AS "wq0" WHERE "wq0"."is_active" = $1 ORDER BY "wq0"."category" ASC, "wq0"."brand" ASC LIMIT 2 OFFSET 1');
    expect(sql.queries[0]!.sql).not.toContain("DISTINCT ON");
    expect(sql.queries[0]!.sql).not.toContain('"wq0"."id" ASC');
    expect(sql.queries[0]!.params).toEqual([true]);
  });

  test("distinct fast path supports three-field keys and preserves explicit order sequence", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, product, {
      distinct: ["category", "brand", "status"],
      select: { category: true, brand: true, status: true },
      orderBy: [{ brand: "desc" }, { category: "asc" }, { status: "asc" }],
    });

    expect(sql.queries[0]!.sql).toBe('SELECT DISTINCT "wq0"."category" AS "category", "wq0"."brand" AS "brand", "wq0"."status" AS "status" FROM "products" AS "wq0" ORDER BY "wq0"."brand" DESC, "wq0"."category" ASC, "wq0"."status" ASC LIMIT 100');
    expect(sql.queries[0]!.sql).not.toContain("DISTINCT ON");
    expect(sql.queries[0]!.sql).not.toContain('"wq0"."id" ASC');
  });

  test("distinct full-row queries choose deterministic representatives", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, product, {
      distinct: ["brand"],
      orderBy: [{ brand: "asc" }, { price: "desc" }],
      take: 5,
    });

    expect(sql.queries[0]!.sql).toBe('SELECT DISTINCT ON ("wq0"."brand") "wq0"."id" AS "id", "wq0"."price" AS "price", "wq0"."created_at" AS "createdAt", "wq0"."is_active" AS "isActive", "wq0"."category" AS "category", "wq0"."brand" AS "brand", "wq0"."status" AS "status", "wq0"."rating" AS "rating" FROM "products" AS "wq0" ORDER BY "wq0"."brand" ASC, "wq0"."price" DESC, "wq0"."id" ASC LIMIT 5');
    expect(sql.queries[0]!.sql).toContain("DISTINCT ON");
  });

  test("distinct partial projections with extra fields stay on representative-row DISTINCT ON", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, product, {
      distinct: ["brand"],
      select: { brand: true, price: true },
      orderBy: [{ brand: "asc" }, { price: "desc" }],
      take: 5,
    });

    expect(sql.queries[0]!.sql).toBe('SELECT DISTINCT ON ("wq0"."brand") "wq0"."brand" AS "brand", "wq0"."price" AS "price" FROM "products" AS "wq0" ORDER BY "wq0"."brand" ASC, "wq0"."price" DESC, "wq0"."id" ASC LIMIT 5');
  });

  test("distinct supports nullable scalar fields using PostgreSQL semantics", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, product, {
      distinct: ["rating"],
      select: { rating: true },
      orderBy: { rating: "asc" },
    });

    expect(sql.queries[0]!.sql).toBe('SELECT DISTINCT "wq0"."rating" AS "rating" FROM "products" AS "wq0" ORDER BY "wq0"."rating" ASC LIMIT 100');
    expect(sql.queries[0]!.sql).not.toContain("DISTINCT ON");
  });

  test("distinct parent queries remain compatible with relation includes", async () => {
    const sql = createFakeSql([]);
    await executeFindMany(sql, schema, user, {
      distinct: ["email"],
      include: { posts: true },
      orderBy: { email: "asc" },
      take: 2,
    });

    expect(sql.queries[0]!.sql).toStartWith('SELECT DISTINCT ON ("wq0"."email")');
    expect(sql.queries[0]!.sql).toContain("json_agg(row_to_json");
    expect(sql.queries[0]!.sql).toContain('ORDER BY "wq0"."email" ASC, "wq0"."id" ASC LIMIT 2');
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
    await expect(executeFindMany(createFakeSql(), schema, post, { cursor: { likes: 100 }, orderBy: { likes: "asc" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, post, { cursor: { id: "p1" }, orderBy: [{ likes: "asc" }, { id: "asc" }] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, post, { cursor: { cost: 10, id: "p1" }, orderBy: [{ cost: "asc" }, { id: "asc" }] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, post, { cursor: { id: "p1" }, orderBy: { id: "asc" }, skip: 1 })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, product, { distinct: [] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, product, { distinct: ["brand", "brand"] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, product, { distinct: ["nope"] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, user, { distinct: ["posts"] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, product, { distinct: ["brand"], orderBy: { price: "desc" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindMany(createFakeSql(), schema, product, { distinct: ["brand"], orderBy: [{ brand: "asc" }], cursor: { brand: "Acme" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeFindFirst(createFakeSql(), schema, product, { distinct: ["brand"] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeAggregate(createFakeSql(), schema, user, { _sum: { email: true } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeGroupBy(createFakeSql(), schema, user, { by: [] })).rejects.toThrow(DatabaseQueryError);
    await expect(executeGroupBy(createFakeSql(), schema, user, { by: ["active"], orderBy: { email: "asc" } })).rejects.toThrow(DatabaseQueryError);
    await expect(executeGroupBy(createFakeSql(), schema, user, { by: ["active"], take: 1.5 })).rejects.toThrow(DatabaseQueryError);
  });
});
