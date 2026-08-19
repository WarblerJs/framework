import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { TransactionSQL } from "bun";
import { executeFindMany, executeFindUnique, type RuntimeModel, type RuntimeReadSchema } from "../src/runtime/read-query";
import { executeTransaction } from "../src/runtime/transaction-query";
import { executeUpdate } from "../src/runtime/write-query";
import { q } from "../src/runtime/read-query";

const rowLockTest = process.env.WARBLER_PG_LOCK_INTEGRATION === "1" ? test : test.skip;

interface WorkItem {
  readonly id: string;
  readonly status: string;
  readonly stock: number;
  readonly createdAt: Date;
  readonly claimedBy: string | null;
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
    name: "WorkItem",
    table,
    defaultOrderColumn: "id",
    primaryKeyFields: Object.freeze(["id"]),
    columns: Object.freeze([
      Object.freeze({ field: "id", column: "id", kind: "string", nullable: false, unique: false, primaryKey: true }),
      Object.freeze({ field: "status", column: "status", kind: "string", nullable: false, unique: false, primaryKey: false }),
      Object.freeze({ field: "stock", column: "stock", kind: "number", nullable: false, unique: false, primaryKey: false }),
      Object.freeze({ field: "createdAt", column: "created_at", kind: "date", pgType: "timestamptz", nullable: false, unique: false, primaryKey: false }),
      Object.freeze({ field: "claimedBy", column: "claimed_by", kind: "string", nullable: true, unique: false, primaryKey: false }),
    ]),
    relations: Object.freeze([]),
  });
  return {
    model,
    schema: Object.freeze({ models: Object.freeze({ WorkItem: model }) }),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function lockNotAvailable(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === "55P03" || String(error).includes("could not obtain lock");
}

async function setupFixture(): Promise<{
  readonly table: string;
  readonly schema: RuntimeReadSchema;
  readonly model: RuntimeModel;
  readonly admin: SQL;
  readonly cleanup: () => Promise<void>;
}> {
  const table = `wlb_row_lock_${process.pid}_${Date.now()}_${Math.trunc(Math.random() * 1_000_000)}`;
  const admin = connection();
  await admin.unsafe(`DROP TABLE IF EXISTS ${q(table)}`);
  await admin.unsafe(`
    CREATE TABLE ${q(table)} (
      id text PRIMARY KEY,
      status text NOT NULL,
      stock integer NOT NULL,
      created_at timestamptz NOT NULL,
      claimed_by text
    )
  `);
  await admin.unsafe(
    `INSERT INTO ${q(table)} (id, status, stock, created_at, claimed_by) VALUES
      ($1, 'pending', 5, '2026-01-01T00:00:00Z', NULL),
      ($2, 'pending', 5, '2026-01-01T00:00:01Z', NULL),
      ($3, 'pending', 5, '2026-01-01T00:00:02Z', NULL),
      ($4, 'pending', 5, '2026-01-01T00:00:03Z', NULL),
      ($5, 'ready', 5, '2026-01-01T00:00:04Z', NULL),
      ($6, 'inventory', 5, '2026-01-01T00:00:05Z', NULL)`,
    ["a", "b", "c", "d", "mode", "inventory"],
  );
  const metadata = schemaFor(table);
  return {
    ...metadata,
    table,
    admin,
    cleanup: async () => {
      await admin.unsafe(`DROP TABLE IF EXISTS ${q(table)}`);
      await admin.end();
    },
  };
}

async function closeAll(connections: readonly SQL[]): Promise<void> {
  await Promise.all(connections.map((sql) => sql.end().catch(() => undefined)));
}

describe("PostgreSQL row locking integration", () => {
  rowLockTest("uses real PostgreSQL row locks for wait, nowait, skip locked, commit, rollback, inventory, and worker queues", async () => {
    const fixture = await setupFixture();
    const a = connection();
    const b = connection();
    const c = connection();

    try {
      await executeTransaction(a, async (tx) => {
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "mode" }, lock: { mode: "update" } });
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "mode" }, lock: { mode: "noKeyUpdate" } });
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "mode" }, lock: { mode: "share" } });
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "mode" }, lock: { mode: "keyShare" } });
      });

      let releaseWaiter = () => {};
      let waiterLocked = () => {};
      const waiterReady = new Promise<void>((resolve) => { waiterLocked = resolve; });
      const holder = executeTransaction(a, async (tx) => {
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "a" }, lock: { mode: "update" } });
        waiterLocked();
        await new Promise<void>((resolve) => { releaseWaiter = resolve; });
      });
      await waiterReady;

      let acquired = false;
      const blocked = executeTransaction(b, async (tx) => {
        const row = await executeFindUnique<WorkItem>(tx, fixture.schema, fixture.model, { where: { id: "a" }, lock: { mode: "update" } });
        acquired = true;
        return row;
      });
      await sleep(100);
      expect(acquired).toBe(false);
      releaseWaiter();
      await expect(blocked).resolves.toMatchObject({ id: "a" });
      await holder;

      let releaseNowait = () => {};
      let nowaitLocked = () => {};
      const nowaitReady = new Promise<void>((resolve) => { nowaitLocked = resolve; });
      const nowaitHolder = executeTransaction(a, async (tx) => {
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "b" }, lock: { mode: "update" } });
        nowaitLocked();
        await new Promise<void>((resolve) => { releaseNowait = resolve; });
      });
      await nowaitReady;
      let nowaitError: unknown;
      try {
        await executeTransaction(b, (tx) => executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "b" }, lock: { mode: "update", wait: "nowait" } }));
      } catch (error) {
        nowaitError = error;
      }
      expect(lockNotAvailable(nowaitError)).toBe(true);
      releaseNowait();
      await nowaitHolder;

      let releaseSkipLocked = () => {};
      let skipLockedReady = () => {};
      const skipReady = new Promise<void>((resolve) => { skipLockedReady = resolve; });
      const skipHolder = executeTransaction(a, async (tx) => {
        await executeFindMany(tx, fixture.schema, fixture.model, {
          where: { status: "pending" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 2,
          lock: { mode: "update" },
        });
        skipLockedReady();
        await new Promise<void>((resolve) => { releaseSkipLocked = resolve; });
      });
      await skipReady;
      const available = await executeTransaction(b, (tx) => executeFindMany<WorkItem>(tx, fixture.schema, fixture.model, {
        where: { status: "pending" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 10,
        lock: { mode: "update", wait: "skipLocked" },
      }));
      expect(available.map((row) => row.id)).toEqual(["c", "d"]);
      releaseSkipLocked();
      await skipHolder;

      await executeTransaction(a, (tx) => executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "c" }, lock: { mode: "update" } }));
      await expect(executeTransaction(b, (tx) => executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "c" }, lock: { mode: "update", wait: "nowait" } }))).resolves.toMatchObject({ id: "c" });

      const rollbackSentinel = new Error("rollback release");
      await executeTransaction(a, async (tx) => {
        await executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "d" }, lock: { mode: "update" } });
        throw rollbackSentinel;
      }).catch((error) => {
        if (error !== rollbackSentinel) throw error;
      });
      await expect(executeTransaction(b, (tx) => executeFindUnique(tx, fixture.schema, fixture.model, { where: { id: "d" }, lock: { mode: "update", wait: "nowait" } }))).resolves.toMatchObject({ id: "d" });

      async function buy(sql: SQL, quantity: number): Promise<boolean> {
        return executeTransaction(sql, async (tx) => {
          const row = await executeFindUnique<WorkItem>(tx, fixture.schema, fixture.model, {
            where: { id: "inventory" },
            select: { id: true, stock: true },
            lock: { mode: "update" },
          });
          if (row === null) throw new Error("Product not found");
          await (tx as TransactionSQL).unsafe("SELECT pg_sleep(0.1)");
          if (row.stock < quantity) return false;
          await executeUpdate(tx, fixture.schema, fixture.model, {
            where: { id: row.id },
            data: { stock: row.stock - quantity },
            select: { id: true, stock: true },
          });
          return true;
        });
      }

      const purchases = await Promise.all([buy(a, 4), buy(b, 4)]);
      expect(purchases.filter(Boolean)).toHaveLength(1);
      const inventory = await fixture.admin.unsafe<{ stock: number }[]>(`SELECT stock FROM ${q(fixture.table)} WHERE id = 'inventory'`);
      expect(inventory[0]?.stock).toBe(1);

      const firstClaim = executeTransaction(a, async (tx) => {
        const rows = await executeFindMany<WorkItem>(tx, fixture.schema, fixture.model, {
          where: { status: "pending" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          lock: { mode: "update", wait: "skipLocked" },
        });
        await (tx as TransactionSQL).unsafe("SELECT pg_sleep(0.1)");
        return rows;
      });
      const secondClaim = executeTransaction(c, (tx) => executeFindMany<WorkItem>(tx, fixture.schema, fixture.model, {
        where: { status: "pending" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        lock: { mode: "update", wait: "skipLocked" },
      }));
      const [firstRows, secondRows] = await Promise.all([firstClaim, secondClaim]);
      expect(firstRows).toHaveLength(1);
      expect(secondRows).toHaveLength(1);
      expect(firstRows[0]?.id).not.toBe(secondRows[0]?.id);
    } finally {
      await closeAll([a, b, c]);
      await fixture.cleanup();
    }
  });
});
