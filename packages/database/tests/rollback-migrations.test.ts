import { describe, expect, test } from "bun:test";
import type { SQL, TransactionSQL } from "bun";
import {
  MigrationDefinitionError,
  MigrationFileNotFoundError,
  MigrationHistoryError,
  MigrationRollbackExecutionError,
  MigrationRollbackStepError,
} from "../src/errors";
import { rollbackMigrations } from "../src/migrations/rollback-migrations";

interface HistoryRow {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly batch: number;
}

interface FakeSql {
  readonly sql: SQL;
  readonly history: readonly HistoryRow[];
  readonly ddlLog: readonly string[];
  readonly lockLog: readonly string[];
}

const checksum = async (path: string): Promise<string> => Bun.hash(await Bun.file(path).text()).toString(16);

function createFakeSql(tableName: string, initialHistory: readonly HistoryRow[], options: { readonly failDeleteFor?: string } = {}): FakeSql {
  let history = [...initialHistory];
  let ddlLog: string[] = [];
  const lockLog: string[] = [];
  const quotedTable = `"${tableName}"`;

  const execute = async (
    query: string,
    values: readonly unknown[] | undefined,
    targetHistory: HistoryRow[],
    targetDdlLog: string[],
  ): Promise<unknown[]> => {
    const trimmed = query.trim();
    if (trimmed === "SELECT pg_advisory_lock($1, $2)") { lockLog.push("lock"); return []; }
    if (trimmed === "SELECT pg_advisory_unlock($1, $2) AS unlocked") { lockLog.push("unlock"); return [{ unlocked: true }]; }
    if (trimmed.startsWith(`CREATE TABLE IF NOT EXISTS ${quotedTable}`)) return [];
    if (trimmed.startsWith(`SELECT id, name, checksum, batch FROM ${quotedTable} ORDER BY id DESC LIMIT $1`)) {
      const [limit] = values as [number];
      return [...targetHistory].sort((left, right) => right.id - left.id).slice(0, limit);
    }
    if (trimmed.startsWith(`DELETE FROM ${quotedTable}`)) {
      const [id, name] = values as [number, string];
      if (options.failDeleteFor === name) throw new Error("delete failed");
      const index = targetHistory.findIndex((row) => row.id === id && row.name === name);
      if (index === -1) return [];
      targetHistory.splice(index, 1);
      return [{ id }];
    }
    targetDdlLog.push(trimmed);
    return [];
  };

  const unsafe = async (query: string, values?: readonly unknown[]): Promise<unknown[]> => execute(query, values, history, ddlLog);

  const sql = {
    unsafe,
    begin: async (fn: (transaction: TransactionSQL) => Promise<void>) => {
      const transactionHistory = [...history];
      const transactionDdlLog = [...ddlLog];
      const tx = {
        unsafe: async (query: string, values?: readonly unknown[]): Promise<unknown[]> => execute(query, values, transactionHistory, transactionDdlLog),
      } as unknown as TransactionSQL;
      await fn(tx);
      history = transactionHistory;
      ddlLog = transactionDdlLog;
    },
    reserve: async () => ({
      unsafe,
      begin: async (fn: (transaction: TransactionSQL) => Promise<void>) => {
        const transactionHistory = [...history];
        const transactionDdlLog = [...ddlLog];
        const tx = {
          unsafe: async (query: string, values?: readonly unknown[]): Promise<unknown[]> => execute(query, values, transactionHistory, transactionDdlLog),
        } as unknown as TransactionSQL;
        await fn(tx);
        history = transactionHistory;
        ddlLog = transactionDdlLog;
      },
      release() {},
    }),
  } as unknown as SQL;

  return {
    sql,
    get history() { return history; },
    get ddlLog() { return ddlLog; },
    lockLog,
  };
}

const migrationSource = (up: string, down: string): string => `import type { PgMigration } from "@warblerjs/database";
export const up: PgMigration = async (pgm) => {
  await pgm.raw("${up}");
};
export const down: PgMigration = async (pgm) => {
  await pgm.raw("${down}");
};
`;

const failingDownSource = (up: string, down: string): string => `import type { PgMigration } from "@warblerjs/database";
export const up: PgMigration = async (pgm) => {
  await pgm.raw("${up}");
};
export const down: PgMigration = async (pgm) => {
  await pgm.raw("${down}");
  throw new Error("down failed");
};
`;

async function writeMigration(root: string, name: string, source: string): Promise<HistoryRow> {
  const path = `${root}/migrations/${name}.ts`;
  await Bun.write(path, source);
  return Object.freeze({ id: Number(name.slice(12, 14)), name, checksum: await checksum(path), batch: 1 });
}

async function createProject(): Promise<Readonly<{ root: string; rows: readonly HistoryRow[] }>> {
  const root = `/tmp/warbler-database-rollback-${crypto.randomUUID()}`;
  const rows = [
    await writeMigration(root, "20260101000001_create_a", migrationSource("-- up A", "-- down A")),
    await writeMigration(root, "20260101000002_create_b", migrationSource("-- up B", "-- down B")),
    await writeMigration(root, "20260101000003_create_c", migrationSource("-- up C", "-- down C")),
  ];
  return Object.freeze({ root, rows: Object.freeze(rows) });
}

describe("rollbackMigrations", () => {
  test("rolls back the latest migration and removes history after down succeeds", async () => {
    const { root, rows } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", rows.slice(0, 1));
    const result = await rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    expect(result.rolledBack).toEqual([{ name: "20260101000001_create_a", batch: 1, executionMs: expect.any(Number) }]);
    expect(fake.ddlLog).toEqual(["-- down A"]);
    expect(fake.history).toEqual([]);
  });

  test("rolls back multiple migrations in reverse application order", async () => {
    const { root, rows } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", rows);
    const result = await rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations", step: 2 });
    expect(result.rolledBack.map((migration) => migration.name)).toEqual(["20260101000003_create_c", "20260101000002_create_b"]);
    expect(fake.ddlLog).toEqual(["-- down C", "-- down B"]);
    expect(fake.history.map((row) => row.name)).toEqual(["20260101000001_create_a"]);
  });

  test("returns a clean no-op when there is nothing to roll back", async () => {
    const { root } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", []);
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" }))
      .resolves.toEqual({ rolledBack: [] });
    expect(fake.ddlLog).toEqual([]);
  });

  test("keeps history when down fails", async () => {
    const { root, rows } = await createProject();
    const row = await writeMigration(root, "20260101000004_create_d", failingDownSource("-- up D", "-- down D"));
    const fake = createFakeSql("_wrbls_migrations", [...rows, row]);
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" }))
      .rejects.toThrow(MigrationRollbackExecutionError);
    expect(fake.history.map((item) => item.name)).toContain("20260101000004_create_d");
    expect(fake.ddlLog).not.toContain("-- down D");
  });

  test("rolls back transaction when history deletion fails", async () => {
    const { root, rows } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", rows, { failDeleteFor: "20260101000003_create_c" });
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" }))
      .rejects.toThrow(MigrationHistoryError);
    expect(fake.history.map((item) => item.name)).toContain("20260101000003_create_c");
    expect(fake.ddlLog).not.toContain("-- down C");
  });

  test("fails safely when the local migration file is missing", async () => {
    const root = `/tmp/warbler-database-rollback-${crypto.randomUUID()}`;
    const fake = createFakeSql("_wrbls_migrations", [{ id: 1, name: "20260101000001_missing", checksum: "abc", batch: 1 }]);
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" }))
      .rejects.toThrow(MigrationFileNotFoundError);
    expect(fake.history).toHaveLength(1);
  });

  test("fails safely when down is missing", async () => {
    const root = `/tmp/warbler-database-rollback-${crypto.randomUUID()}`;
    const name = "20260101000001_no_down";
    const path = `${root}/migrations/${name}.ts`;
    await Bun.write(path, `import type { PgMigration } from "@warblerjs/database";
export const up: PgMigration = async () => {};
`);
    const fake = createFakeSql("_wrbls_migrations", [{ id: 1, name, checksum: await checksum(path), batch: 1 }]);
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" }))
      .rejects.toThrow(MigrationDefinitionError);
    expect(fake.history).toHaveLength(1);
  });

  test("validates rollback step", async () => {
    const { root } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", []);
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations", step: 1 })).resolves.toEqual({ rolledBack: [] });
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations", step: 2 })).resolves.toEqual({ rolledBack: [] });
    for (const step of [0, -1, 1.5, NaN]) {
      await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations", step }))
        .rejects.toThrow(MigrationRollbackStepError);
    }
  });

  test("rolls back only available migrations when step is larger than history", async () => {
    const { root, rows } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", rows.slice(0, 2));
    const result = await rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations", step: 10 });
    expect(result.rolledBack.map((migration) => migration.name)).toEqual(["20260101000002_create_b", "20260101000001_create_a"]);
    expect(fake.history).toEqual([]);
  });

  test("commits earlier rollback steps when a later step fails", async () => {
    const root = `/tmp/warbler-database-rollback-${crypto.randomUUID()}`;
    const rows = [
      await writeMigration(root, "20260101000001_create_a", migrationSource("-- up A", "-- down A")),
      await writeMigration(root, "20260101000002_create_b", failingDownSource("-- up B", "-- down B")),
      await writeMigration(root, "20260101000003_create_c", migrationSource("-- up C", "-- down C")),
    ];
    const fake = createFakeSql("_wrbls_migrations", rows);
    await expect(rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations", step: 3 }))
      .rejects.toThrow(MigrationRollbackExecutionError);
    expect(fake.ddlLog).toEqual(["-- down C"]);
    expect(fake.history.map((row) => row.name)).toEqual([
      "20260101000001_create_a",
      "20260101000002_create_b",
    ]);
  });

  test("uses and releases the PostgreSQL advisory migration lock", async () => {
    const { root } = await createProject();
    const fake = createFakeSql("_wrbls_migrations", []);
    await rollbackMigrations(fake.sql, { projectRoot: root, path: "migrations", table: "_wrbls_migrations" });
    expect(fake.lockLog).toEqual(["lock", "unlock"]);
  });
});
