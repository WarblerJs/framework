import { describe, expect, test } from "bun:test";
import type { SQL, TransactionSQL } from "bun";
import { MigrationChecksumError } from "../src/errors";
import { runMigrations } from "../src/migrations/run-migrations";

interface FakeSql {
  readonly sql: SQL;
  readonly executedMigrations: readonly { id: number; name: string; checksum: string; batch: number }[];
  readonly ddlLog: readonly string[];
}

function createFakeSql(tableName: string): FakeSql {
  const executedMigrations: { id: number; name: string; checksum: string; batch: number }[] = [];
  const ddlLog: string[] = [];
  const quotedTable = `"${tableName}"`;
  let nextId = 1;

  const unsafe = async (query: string, values?: readonly unknown[]): Promise<unknown[]> => {
    const trimmed = query.trim();
    if (trimmed === "SELECT pg_advisory_lock($1, $2)") return [];
    if (trimmed === "SELECT pg_advisory_unlock($1, $2) AS unlocked") return [{ unlocked: true }];
    if (trimmed.startsWith(`CREATE TABLE IF NOT EXISTS ${quotedTable}`)) return [];
    if (trimmed.startsWith(`SELECT id, name, checksum, batch FROM ${quotedTable}`)) return [...executedMigrations];
    if (trimmed.startsWith("SELECT max(batch)")) {
      if (executedMigrations.length === 0) return [{ max: null }];
      return [{ max: Math.max(...executedMigrations.map((row) => row.batch)) }];
    }
    if (trimmed.startsWith(`INSERT INTO ${quotedTable}`)) {
      const [name, checksum, batch] = values as [string, string, number, number];
      executedMigrations.push({ id: nextId++, name, checksum, batch });
      return [];
    }
    ddlLog.push(trimmed);
    return [];
  };

  const tx = { unsafe } as unknown as TransactionSQL;
  const sql = {
    unsafe,
    begin: async (fn: (transaction: TransactionSQL) => Promise<void>) => fn(tx),
    reserve: async () => ({ unsafe, begin: async (fn: (transaction: TransactionSQL) => Promise<void>) => fn(tx), release() {} }),
  } as unknown as SQL;

  return { sql, executedMigrations, ddlLog };
}

const migrationSource = (comment: string) => `import type { PgMigration } from "@warblerjs/database";
export const up: PgMigration = async (pgm) => {
  await pgm.raw("${comment}");
};
export const down: PgMigration = async (pgm) => {
  await pgm.raw("-- reverse: ${comment}");
};
`;

const createProject = async (): Promise<string> => {
  const root = `/tmp/warbler-database-migrations-${crypto.randomUUID()}`;
  await Bun.write(`${root}/migrations/20260101000000_create_table_users.ts`, migrationSource("-- create users table"));
  await Bun.write(`${root}/migrations/20260102000000_add_column_bio.ts`, migrationSource("-- add bio column"));
  return root;
};

describe("runMigrations", () => {
  test("runs pending migrations in filename order, records them, and skips them on the next run", async () => {
    const root = await createProject();
    const { sql, executedMigrations, ddlLog } = createFakeSql("_wrbls_migrations");

    const first = await runMigrations(sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    expect(first.executed.map((migration) => migration.name)).toEqual([
      "20260101000000_create_table_users",
      "20260102000000_add_column_bio",
    ]);
    expect(first.executed.every((migration) => migration.batch === 1)).toBe(true);
    expect(executedMigrations).toHaveLength(2);
    expect(ddlLog).toContain("-- create users table");
    expect(ddlLog).toContain("-- add bio column");

    const second = await runMigrations(sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    expect(second.executed).toEqual([]);
  });

  test("a later scaffold gets the next batch number", async () => {
    const root = await createProject();
    const { sql } = createFakeSql("_wrbls_migrations");
    await runMigrations(sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    await Bun.write(`${root}/migrations/20260103000000_add_column_avatar.ts`, migrationSource("-- add avatar column"));
    const result = await runMigrations(sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    expect(result.executed).toEqual([{ name: "20260103000000_add_column_avatar", batch: 2, executionMs: expect.any(Number) }]);
  });

  test("throws MigrationChecksumError when a previously-executed migration file changes", async () => {
    const root = await createProject();
    const { sql } = createFakeSql("_wrbls_migrations");
    await runMigrations(sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    await Bun.write(`${root}/migrations/20260101000000_create_table_users.ts`, migrationSource("-- changed"));
    await expect(runMigrations(sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" }))
      .rejects.toThrow(MigrationChecksumError);
  });
});
