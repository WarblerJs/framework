import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { TransactionSQL } from "bun";
import { executeCreateMany } from "../src/runtime/write-query";
import { executeFindMany, executeFindUnique, q, type RuntimeModel, type RuntimeReadSchema } from "../src/runtime/read-query";
import { runSeeds } from "../src/seeds/run-seeds";

const seedIntegrationTest = process.env.WARBLER_PG_SEED_INTEGRATION === "1" ? test : test.skip;

interface ItemRow {
  readonly id: string;
  readonly status: string;
  readonly stock: number;
  readonly createdAt: Date;
}

interface SeedDb {
  readonly item: {
    createMany(args: { readonly data: readonly { readonly id: string; readonly status: string; readonly stock: number; readonly createdAt: Date }[] }): Promise<unknown>;
    findMany(args: { readonly where?: { readonly status?: string }; readonly orderBy?: { readonly id?: "asc" | "desc" }; readonly take?: number }): Promise<readonly ItemRow[]>;
    findUnique(args: { readonly where: { readonly id: string }; readonly select?: { readonly id?: boolean; readonly stock?: boolean }; readonly lock?: { readonly mode: "update" } }): Promise<Pick<ItemRow, "id" | "stock"> | null>;
  };
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
    name: "Item",
    table,
    defaultOrderColumn: "id",
    primaryKeyFields: Object.freeze(["id"]),
    columns: Object.freeze([
      Object.freeze({ field: "id", column: "id", kind: "string", nullable: false, unique: false, primaryKey: true }),
      Object.freeze({ field: "status", column: "status", kind: "string", nullable: false, unique: false, primaryKey: false }),
      Object.freeze({ field: "stock", column: "stock", kind: "number", nullable: false, unique: false, primaryKey: false }),
      Object.freeze({ field: "createdAt", column: "created_at", kind: "date", pgType: "timestamptz", nullable: false, unique: false, primaryKey: false }),
    ]),
    relations: Object.freeze([]),
  });
  return {
    model,
    schema: Object.freeze({ models: Object.freeze({ Item: model }) }),
  };
}

function createSeedClient(tx: TransactionSQL, schema: RuntimeReadSchema, model: RuntimeModel): SeedDb {
  const item: SeedDb["item"] = {
    createMany: (args) => executeCreateMany(tx, schema, model, args),
    findMany: (args) => executeFindMany<ItemRow>(tx, schema, model, args),
    findUnique: (args) => executeFindUnique<Pick<ItemRow, "id" | "stock">>(tx, schema, model, args),
  };
  return Object.freeze({
    item: Object.freeze(item),
  });
}

describe("tracked seed integration", () => {
  seedIntegrationTest("runs seed files through an ORM transaction client and tracks committed files once", async () => {
    const root = `/tmp/warbler-database-seed-integration-${crypto.randomUUID()}`;
    const table = `wlb_seed_items_${process.pid}_${Date.now()}_${Math.trunc(Math.random() * 1_000_000)}`;
    const seedTable = `wlb_seed_history_${process.pid}_${Date.now()}_${Math.trunc(Math.random() * 1_000_000)}`;
    const sql = connection();
    const { schema, model } = schemaFor(table);

    await Bun.write(`${root}/seeds/0001_items.seed.ts`, `import type { PgSeed } from "@warbler/database";

type SeedDb = {
  readonly item: {
    createMany(args: { readonly data: readonly { readonly id: string; readonly status: string; readonly stock: number; readonly createdAt: Date }[] }): Promise<unknown>;
    findMany(args: { readonly where?: { readonly status?: string }; readonly orderBy?: { readonly id?: "asc" | "desc" }; readonly take?: number }): Promise<readonly { readonly id: string }[]>;
    findUnique(args: { readonly where: { readonly id: string }; readonly select?: { readonly id?: boolean; readonly stock?: boolean }; readonly lock?: { readonly mode: "update" } }): Promise<{ readonly id: string; readonly stock: number } | null>;
  };
};

export const seed: PgSeed<SeedDb> = async (db) => {
  await db.item.createMany({
    data: [
      { id: "seed-a", status: "pending", stock: 3, createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "seed-b", status: "pending", stock: 4, createdAt: new Date("2026-01-01T00:00:01Z") },
    ],
  });
  const rows = await db.item.findMany({ where: { status: "pending" }, orderBy: { id: "asc" }, take: 10 });
  if (rows.length !== 2) throw new Error("seed ORM findMany failed");
  const locked = await db.item.findUnique({ where: { id: "seed-a" }, select: { id: true, stock: true }, lock: { mode: "update" } });
  if (locked?.stock !== 3) throw new Error("seed ORM lock failed");
};
`);

    try {
      await sql.unsafe(`DROP TABLE IF EXISTS ${q(seedTable)}`);
      await sql.unsafe(`DROP TABLE IF EXISTS ${q(table)}`);
      await sql.unsafe(`
        CREATE TABLE ${q(table)} (
          id text PRIMARY KEY,
          status text NOT NULL,
          stock integer NOT NULL,
          created_at timestamptz NOT NULL
        )
      `);

      const first = await runSeeds(sql, {
        projectRoot: root,
        path: "seeds",
        table: seedTable,
        createClient: (tx) => createSeedClient(tx, schema, model),
      });
      const second = await runSeeds(sql, {
        projectRoot: root,
        path: "seeds",
        table: seedTable,
        createClient: (tx) => createSeedClient(tx, schema, model),
      });

      const items = await sql.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM ${q(table)}`);
      const tracked = await sql.unsafe<{ name: string; batch: number }[]>(`SELECT name, batch FROM ${q(seedTable)} ORDER BY name`);

      expect(first.executed).toEqual([{ name: "0001_items.seed.ts", batch: 1 }]);
      expect(second.executed).toEqual([]);
      expect(items[0]?.count).toBe(2);
      expect(tracked).toEqual([{ name: "0001_items.seed.ts", batch: 1 }]);
    } finally {
      await sql.unsafe(`DROP TABLE IF EXISTS ${q(seedTable)}`).catch(() => undefined);
      await sql.unsafe(`DROP TABLE IF EXISTS ${q(table)}`).catch(() => undefined);
      await sql.end();
    }
  });
});
