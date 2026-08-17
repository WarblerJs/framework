import type { SQL } from "bun";
import { pathToFileURL } from "node:url";
import { createPgMigrationContext } from "./create-pg-migration-context";
import {
  MigrationChecksumError,
  MigrationDefinitionError,
  MigrationFileNotFoundError,
  MigrationHistoryError,
  MigrationRollbackExecutionError,
  MigrationRollbackStepError,
} from "../errors";
import { quoteIdentifier } from "../utils/sql-identifier";
import { checksumOf, ensureMigrationsTable, migrationFilePath, withMigrationLock, type ExecutedMigrationRow } from "./internal";
import type { PgMigration } from "./types";

export interface RollbackMigrationsOptions {
  readonly projectRoot: string;
  readonly path: string;
  readonly table: string;
  readonly step?: number;
}

export interface RolledBackMigration {
  readonly name: string;
  readonly batch: number;
  readonly executionMs: number;
}

export interface MigrationRollbackResult {
  readonly rolledBack: readonly RolledBackMigration[];
}

interface MigrationModule {
  readonly down?: PgMigration;
}

function normalizeStep(step: number | undefined): number {
  if (step === undefined) return 1;
  if (!Number.isSafeInteger(step)) throw new MigrationRollbackStepError("step must be a positive safe integer.");
  if (step <= 0) throw new MigrationRollbackStepError("step must be greater than zero.");
  return step;
}

async function loadLatestAppliedMigrations(sql: SQL, table: string, step: number): Promise<readonly ExecutedMigrationRow[]> {
  try {
    return await sql.unsafe<ExecutedMigrationRow[]>(
      `SELECT id, name, checksum, batch FROM ${quoteIdentifier(table)} ORDER BY id DESC LIMIT $1`,
      [step],
    );
  } catch (cause) {
    throw new MigrationHistoryError("read", "could not load applied migrations.", cause);
  }
}

async function deleteMigrationHistory(tx: SQL, table: string, row: ExecutedMigrationRow): Promise<void> {
  try {
    const deleted = await tx.unsafe<{ id: number }[]>(
      `DELETE FROM ${quoteIdentifier(table)} WHERE id = $1 AND name = $2 RETURNING id`,
      [row.id, row.name],
    );
    if (deleted.length !== 1) {
      throw new Error(`Expected to delete one history row for "${row.name}", deleted ${deleted.length}.`);
    }
  } catch (cause) {
    throw new MigrationHistoryError("delete", `could not remove "${row.name}" from migration history.`, cause);
  }
}

async function loadDownMigration(row: ExecutedMigrationRow, path: string): Promise<PgMigration> {
  if (!await Bun.file(path).exists()) throw new MigrationFileNotFoundError(row.name, path);
  if (await checksumOf(path) !== row.checksum) throw new MigrationChecksumError(row.name);
  const module = await import(pathToFileURL(path).href) as MigrationModule;
  if (typeof module.down !== "function") {
    throw new MigrationDefinitionError(row.name, "Migration must export a `down` function.");
  }
  return module.down;
}

async function rollbackOne(sql: SQL, options: RollbackMigrationsOptions, row: ExecutedMigrationRow): Promise<RolledBackMigration> {
  const path = migrationFilePath(options.projectRoot, options.path, row.name);
  const down = await loadDownMigration(row, path);
  let executionMs = 0;
  await sql.begin(async (tx) => {
    const start = performance.now();
    try {
      await down(createPgMigrationContext(tx));
    } catch (cause) {
      throw new MigrationRollbackExecutionError(row.name, cause);
    }
    executionMs = Math.round(performance.now() - start);
    await deleteMigrationHistory(tx, options.table, row);
  });
  return Object.freeze({ name: row.name, batch: row.batch, executionMs });
}

/** Rolls back the latest applied PostgreSQL migration(s), newest first, using one transaction per migration. */
export async function rollbackMigrations(sql: SQL, options: RollbackMigrationsOptions): Promise<MigrationRollbackResult> {
  const step = normalizeStep(options.step);
  return withMigrationLock(sql, "migration rollback", async (lockedSql) => {
    try {
      await ensureMigrationsTable(lockedSql, options.table);
    } catch (cause) {
      throw new MigrationHistoryError("read", "could not ensure the migration history table exists.", cause);
    }
    const applied = await loadLatestAppliedMigrations(lockedSql, options.table, step);
    if (applied.length === 0) return Object.freeze({ rolledBack: Object.freeze([]) });

    const rolledBack: RolledBackMigration[] = [];
    for (const row of applied) {
      rolledBack.push(await rollbackOne(lockedSql, options, row));
    }
    return Object.freeze({ rolledBack: Object.freeze(rolledBack) });
  });
}
