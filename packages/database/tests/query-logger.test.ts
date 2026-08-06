import { describe, expect, test } from "bun:test";
import type { SQL, TransactionSQL } from "bun";
import { withQueryLogging, type QueryLogEntry } from "../src/runtime/query-logger";

function createFakeSql(): SQL {
  function fn(...args: unknown[]): unknown {
    return Promise.resolve([{ args }]);
  }
  Object.assign(fn, {
    unsafe: async (query: string, params?: readonly unknown[]) => [{ query, params }],
    begin: async (callback: (tx: TransactionSQL) => unknown) => callback(fn as unknown as TransactionSQL),
  });
  return fn as unknown as SQL;
}

describe("withQueryLogging", () => {
  test("logs a tagged-template call as a $1-parameterized query", async () => {
    const entries: QueryLogEntry[] = [];
    const sql = withQueryLogging(createFakeSql(), (entry) => entries.push(entry));

    await sql`SELECT * FROM users WHERE id = ${1} AND active = ${true}`;

    expect(entries).toEqual([{ text: "SELECT * FROM users WHERE id = $1 AND active = $2", params: [1, true] }]);
  });

  test("logs .unsafe() calls with their raw text and params", async () => {
    const entries: QueryLogEntry[] = [];
    const sql = withQueryLogging(createFakeSql(), (entry) => entries.push(entry));

    await sql.unsafe("SELECT 1", [7]);

    expect(entries).toEqual([{ text: "SELECT 1", params: [7] }]);
  });

  test("logs queries run inside .begin()", async () => {
    const entries: QueryLogEntry[] = [];
    const sql = withQueryLogging(createFakeSql(), (entry) => entries.push(entry));

    await sql.begin(async (tx) => {
      await tx`SELECT 2`;
      await tx.unsafe("SELECT 3");
    });

    expect(entries).toEqual([
      { text: "SELECT 2", params: [] },
      { text: "SELECT 3", params: [] },
    ]);
  });

  test("does not log sql(value) fragment-helper calls", async () => {
    const entries: QueryLogEntry[] = [];
    const sql = withQueryLogging(createFakeSql(), (entry) => entries.push(entry));

    (sql as unknown as (value: unknown) => unknown)({ id: 1 });

    expect(entries).toEqual([]);
  });
});
