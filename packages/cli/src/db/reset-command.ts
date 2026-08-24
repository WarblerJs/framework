import { createPgConnection, resetDatabase, runMigrations, runSeeds, type ExecutedMigration, type ExecutedSeed } from "@warblerjs/database";
import type { ProjectLayout } from "../project";
import { requireDatabaseConfig } from "./shared";
import { createLazySeedClientFactory } from "./seed-command";

export interface MigrateFreshCommandOptions {
  readonly seed: boolean;
}

export interface MigrateFreshCommandResult {
  readonly executed: readonly ExecutedMigration[];
  readonly seeded: readonly ExecutedSeed[];
}

/** `warbler db:pg migrate:fresh`: drops public schema objects, replays migrations, and optionally runs pending tracked seeds. */
export async function migrateFreshCommand(layout: ProjectLayout, options: MigrateFreshCommandOptions): Promise<MigrateFreshCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const sql = createPgConnection(config.connection, config.log === true);
  try {
    await resetDatabase(sql);
    const migrated = await runMigrations(sql, {
      projectRoot: layout.root,
      path: config.migrations.path,
      table: config.migrations.table,
    });
    if (!options.seed) return Object.freeze({ executed: migrated.executed, seeded: Object.freeze([]) });
    const seeded = await runSeeds(sql, {
      projectRoot: layout.root,
      path: config.migrations.seeds,
      ...(config.migrations.seedTable === undefined ? {} : { table: config.migrations.seedTable }),
      createClient: createLazySeedClientFactory(layout, config.migrations.generated),
    });
    return Object.freeze({ executed: migrated.executed, seeded: seeded.executed });
  } finally {
    await sql.close();
  }
}
