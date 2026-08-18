import { describe, expect, test } from "bun:test";
import type { SQL, TransactionSQL } from "bun";
import { DatabaseTransactionError } from "../src/errors";
import { executeTransaction } from "../src/runtime/transaction-query";

interface FakeSql {
  readonly sql: SQL;
  readonly poolQueries: readonly { sql: string; params: readonly unknown[] }[];
  readonly txQueries: readonly { sql: string; params: readonly unknown[] }[];
  readonly beginOptions: readonly (string | undefined)[];
  readonly rollbacks: number;
}

function createFakeSql(): FakeSql {
  const poolQueries: { sql: string; params: readonly unknown[] }[] = [];
  const txQueries: { sql: string; params: readonly unknown[] }[] = [];
  const beginOptions: (string | undefined)[] = [];
  let rollbacks = 0;

  const tx = {
    unsafe: async (sql: string, params?: readonly unknown[]) => {
      txQueries.push({ sql, params: params ?? [] });
      return [{ from: "tx" }];
    },
  } as unknown as TransactionSQL;

  const sql = {
    unsafe: async (sql: string, params?: readonly unknown[]) => {
      poolQueries.push({ sql, params: params ?? [] });
      return [{ from: "pool" }];
    },
    begin: async (...args: unknown[]) => {
      const callback = args.at(-1) as (transaction: TransactionSQL) => unknown;
      beginOptions.push(typeof args[0] === "string" ? args[0] : undefined);
      try {
        return await callback(tx);
      } catch (error) {
        rollbacks++;
        throw error;
      }
    },
  } as unknown as SQL;

  return {
    sql,
    poolQueries,
    txQueries,
    beginOptions,
    get rollbacks() { return rollbacks; },
  };
}

describe("executeTransaction", () => {
  test("runs callback operations against the transaction-bound SQL object", async () => {
    const fake = createFakeSql();
    const result = await executeTransaction(fake.sql, async (tx) => {
      const rows = await tx.unsafe("SELECT $1", ["inside"]);
      return { rows };
    });

    expect(result).toEqual({ rows: [{ from: "tx" }] });
    expect(fake.poolQueries).toEqual([]);
    expect(fake.txQueries).toEqual([{ sql: "SELECT $1", params: ["inside"] }]);
    expect(fake.beginOptions).toEqual([undefined]);
  });

  test("translates trusted options and applies timeout through SET LOCAL", async () => {
    const fake = createFakeSql();
    await executeTransaction(fake.sql, async (tx) => {
      await tx.unsafe("SELECT 1");
    }, {
      isolationLevel: "serializable",
      readOnly: true,
      timeout: 5_000,
    });

    expect(fake.beginOptions).toEqual(["isolation level serializable read only"]);
    expect(fake.txQueries).toEqual([
      { sql: "SELECT set_config('statement_timeout', $1, true)", params: ["5000ms"] },
      { sql: "SELECT 1", params: [] },
    ]);
  });

  test("rethrows the original callback error", async () => {
    const fake = createFakeSql();
    const original = new Error("application failure");

    await expect(executeTransaction(fake.sql, () => {
      throw original;
    })).rejects.toBe(original);
    expect(fake.rollbacks).toBe(1);
  });

  test("rejects invalid options before opening a transaction", async () => {
    const fake = createFakeSql();
    await expect(executeTransaction(fake.sql, () => undefined, { timeout: 0 })).rejects.toThrow(DatabaseTransactionError);
    await expect(executeTransaction(fake.sql, () => undefined, { timeout: 1.5 })).rejects.toThrow(DatabaseTransactionError);
    await expect(executeTransaction(fake.sql, () => undefined, { isolationLevel: "read uncommitted" as never })).rejects.toThrow(DatabaseTransactionError);
    expect(fake.beginOptions).toEqual([]);
  });

  test("transaction SQL cannot be used after the callback completes", async () => {
    const fake = createFakeSql();
    let leaked: TransactionSQL | undefined;

    await executeTransaction(fake.sql, (tx) => {
      leaked = tx;
      return "done";
    });

    expect(() => leaked!.unsafe("SELECT 1")).toThrow(DatabaseTransactionError);
  });
});
