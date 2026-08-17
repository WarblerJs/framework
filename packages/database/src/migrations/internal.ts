import type { ReservedSQL, SQL } from "bun";
import { MigrationLockError } from "../errors";
import { quoteIdentifier } from "../utils/sql-identifier";

export interface MigrationFile {
  readonly name: string;
  readonly path: string;
}

export interface ExecutedMigrationRow {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly batch: number;
}

const MIGRATION_LOCK_NAMESPACE = 2_002_934_898;
const MIGRATION_LOCK_KEY = 1_835_620_210;

export const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function migrationFilePath(projectRoot: string, migrationsPath: string, name: string): string {
  return `${projectRoot}/${migrationsPath}/${name}.ts`;
}

export async function discoverMigrationFiles(migrationsDirectory: string): Promise<readonly MigrationFile[]> {
  const glob = new Bun.Glob("*.ts");
  const fileNames: string[] = [];
  for await (const fileName of glob.scan({ cwd: migrationsDirectory, onlyFiles: true })) {
    fileNames.push(fileName);
  }
  fileNames.sort(compareText);
  return Object.freeze(fileNames.map((fileName) => Object.freeze({
    name: fileName.replace(/\.ts$/u, ""),
    path: `${migrationsDirectory}/${fileName}`,
  })));
}

export async function ensureMigrationsTable(sql: SQL, table: string): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      batch INTEGER NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      execution_ms INTEGER NOT NULL
    );
  `);
}

export async function loadExecutedMigrations(sql: SQL, table: string): Promise<Map<string, ExecutedMigrationRow>> {
  const rows = await sql.unsafe<ExecutedMigrationRow[]>(`SELECT id, name, checksum, batch FROM ${quoteIdentifier(table)}`);
  return new Map(rows.map((row) => [row.name, row]));
}

export async function nextBatch(sql: SQL, table: string): Promise<number> {
  const rows = await sql.unsafe<{ max: number | null }[]>(`SELECT max(batch) AS max FROM ${quoteIdentifier(table)}`);
  return (rows[0]?.max ?? 0) + 1;
}

export async function checksumOf(path: string): Promise<string> {
  const source = await Bun.file(path).text();
  return Bun.hash(source).toString(16);
}

export async function withMigrationLock<T>(sql: SQL, operation: string, run: (lockedSql: SQL) => Promise<T>): Promise<T> {
  let reserved: ReservedSQL;
  try {
    reserved = await sql.reserve();
    await reserved.unsafe("SELECT pg_advisory_lock($1, $2)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY]);
  } catch (cause) {
    throw new MigrationLockError(operation, "acquire", cause);
  }

  let operationFailed = false;
  try {
    return await run(reserved);
  } catch (cause) {
    operationFailed = true;
    throw cause;
  } finally {
    try {
      const rows = await reserved.unsafe<{ unlocked: boolean }[]>("SELECT pg_advisory_unlock($1, $2) AS unlocked", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY]);
      if (rows[0]?.unlocked !== true) throw new Error("PostgreSQL did not release the migration advisory lock.");
    } catch (cause) {
      if (!operationFailed) throw new MigrationLockError(operation, "release", cause);
    } finally {
      reserved.release();
    }
  }
}
