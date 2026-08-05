import type { SQL } from "bun";
import { pathToFileURL } from "node:url";
import { createPgMigrationContext } from "./create-pg-migration-context";
import { DatabaseCompileError, MigrationChecksumError } from "../errors";
import { quoteIdentifier } from "../utils/sql-identifier";
import type { PgMigration } from "./types";

export interface RunMigrationsOptions {
  readonly projectRoot: string;
  readonly path: string;
  readonly table: string;
}

export interface ExecutedMigration {
  readonly name: string;
  readonly batch: number;
  readonly executionMs: number;
}

export interface MigrationRunResult {
  readonly executed: readonly ExecutedMigration[];
}

interface MigrationFile {
  readonly name: string;
  readonly path: string;
}

interface ExecutedRow {
  readonly name: string;
  readonly checksum: string;
  readonly batch: number;
}

interface MigrationModule {
  readonly up?: PgMigration;
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

async function discoverMigrationFiles(migrationsDirectory: string): Promise<readonly MigrationFile[]> {
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

async function ensureMigrationsTable(sql: SQL, table: string): Promise<void> {
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

async function loadExecutedMigrations(sql: SQL, table: string): Promise<Map<string, ExecutedRow>> {
  const rows = await sql.unsafe<ExecutedRow[]>(`SELECT name, checksum, batch FROM ${quoteIdentifier(table)}`);
  return new Map(rows.map((row) => [row.name, row]));
}

async function nextBatch(sql: SQL, table: string): Promise<number> {
  const rows = await sql.unsafe<{ max: number | null }[]>(`SELECT max(batch) AS max FROM ${quoteIdentifier(table)}`);
  return (rows[0]?.max ?? 0) + 1;
}

async function checksumOf(path: string): Promise<string> {
  const source = await Bun.file(path).text();
  return Bun.hash(source).toString(16);
}

/**
 * Runs every pending migration under `options.path`, one per transaction, recording each into
 * `options.table`. Migrations already recorded are skipped; if a recorded migration's file content
 * has since changed (checksum mismatch), the run is aborted before anything executes.
 */
export async function runMigrations(sql: SQL, options: RunMigrationsOptions): Promise<MigrationRunResult> {
  await ensureMigrationsTable(sql, options.table);
  const migrationsDirectory = `${options.projectRoot}/${options.path}`;
  const files = await discoverMigrationFiles(migrationsDirectory);
  const executedByName = await loadExecutedMigrations(sql, options.table);

  for (const file of files) {
    const recorded = executedByName.get(file.name);
    if (recorded === undefined) continue;
    if (await checksumOf(file.path) !== recorded.checksum) throw new MigrationChecksumError(file.name);
  }

  const pending = files.filter((file) => !executedByName.has(file.name));
  if (pending.length === 0) return Object.freeze({ executed: Object.freeze([]) });

  const batch = await nextBatch(sql, options.table);
  const executed: ExecutedMigration[] = [];
  for (const file of pending) {
    const checksum = await checksumOf(file.path);
    const module = await import(pathToFileURL(file.path).href) as MigrationModule;
    if (typeof module.up !== "function") {
      throw new DatabaseCompileError(file.name, "Migration must export an `up` function.");
    }
    const up = module.up;
    const start = performance.now();
    await sql.begin(async (tx) => {
      await up(createPgMigrationContext(tx));
      const executionMs = Math.round(performance.now() - start);
      await tx.unsafe(
        `INSERT INTO ${quoteIdentifier(options.table)} (name, checksum, batch, execution_ms) VALUES ($1, $2, $3, $4)`,
        [file.name, checksum, batch, executionMs],
      );
      executed.push(Object.freeze({ name: file.name, batch, executionMs }));
    });
  }
  return Object.freeze({ executed: Object.freeze(executed) });
}
