import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import {
  executeCreate,
  executeForceDelete,
  executeRestore,
  executeSoftDelete,
} from "../src/runtime/write-query";
import { executeFindMany, executeFindUnique, q, type RuntimeModel, type RuntimeReadSchema } from "../src/runtime/read-query";
import { executeTransaction } from "../src/runtime/transaction-query";

const softDeleteTest = process.env.WARBLER_PG_SOFT_DELETE_INTEGRATION === "1" ? test : test.skip;

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly deletedAt: Date | null;
}

function connection(): SQL {
  const url = process.env.DATABASE_URL ?? "";
  return new SQL({
    adapter: "postgres",
    ...(url.length > 0 ? { url } : {
      hostname: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_DATABASE ?? "warbler_playground",
      username: process.env.DB_USERNAME ?? "warbler",
      password: process.env.DB_PASSWORD ?? "warbler",
      ssl: process.env.DB_SSL === "true",
    }),
    max: 1,
  });
}

function schemaFor(table: string): { readonly schema: RuntimeReadSchema; readonly model: RuntimeModel } {
  const model: RuntimeModel = Object.freeze({
    name: "User",
    table,
    defaultOrderColumn: "id",
    primaryKeyFields: Object.freeze(["id"]),
    softDelete: Object.freeze({ column: "deleted_at", field: "deletedAt" }),
    columns: Object.freeze([
      Object.freeze({ field: "id", column: "id", kind: "string", nullable: false, unique: false, primaryKey: true }),
      Object.freeze({ field: "email", column: "email", kind: "string", nullable: false, unique: false, primaryKey: false }),
      Object.freeze({ field: "deletedAt", column: "deleted_at", kind: "date", pgType: "timestamp", nullable: true, unique: false, primaryKey: false }),
    ]),
    relations: Object.freeze([]),
  });
  return { model, schema: Object.freeze({ models: Object.freeze({ User: model }) }) };
}

describe("PostgreSQL soft delete integration", () => {
  softDeleteTest("uses active-only partial unique indexes and preserves restore conflicts", async () => {
    const sql = connection();
    const table = `wlb_soft_delete_${process.pid}_${Date.now()}_${Math.trunc(Math.random() * 1_000_000)}`;
    const { schema, model } = schemaFor(table);
    try {
      await sql.unsafe(`DROP TABLE IF EXISTS ${q(table)}`);
      await sql.unsafe(`CREATE TABLE ${q(table)} (id text PRIMARY KEY, email text NOT NULL, deleted_at timestamp NULL)`);
      await sql.unsafe(`CREATE UNIQUE INDEX ${q(`${table}_email_active_key`)} ON ${q(table)} (email) WHERE deleted_at IS NULL`);

      await executeCreate(sql, schema, model, { data: { id: "u1", email: "foo@example.com" } });
      await expect(executeCreate(sql, schema, model, { data: { id: "u2", email: "foo@example.com" } })).rejects.toThrow();
      await executeSoftDelete(sql, schema, model, { where: { id: "u1" } });
      await expect(executeFindUnique<UserRow>(sql, schema, model, { where: { id: "u1" } })).resolves.toBeNull();
      await expect(executeFindUnique<UserRow>(sql, schema, model, { where: { id: "u1" }, withDeleted: true })).resolves.toMatchObject({ id: "u1" });

      await executeCreate(sql, schema, model, { data: { id: "u2", email: "foo@example.com" } });
      await expect(executeRestore(sql, schema, model, { where: { id: "u1" } })).rejects.toThrow();
      await executeForceDelete(sql, schema, model, { where: { id: "u2" } });
      await executeRestore(sql, schema, model, { where: { id: "u1" } });

      await expect(executeTransaction(sql, async (tx) => {
        await executeSoftDelete(tx, schema, model, { where: { id: "u1" } });
        throw new Error("rollback");
      })).rejects.toThrow("rollback");

      await expect(executeFindMany<UserRow>(sql, schema, model, {})).resolves.toHaveLength(1);
    } finally {
      await sql.unsafe(`DROP TABLE IF EXISTS ${q(table)}`).catch(() => undefined);
      await sql.end();
    }
  });
});
