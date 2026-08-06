import { createPgConnection, resetDatabase, runMigrations, runSeeds, type ExecutedMigration } from "@warbler/database";
import type { ProjectLayout } from "../project";
import { requireDatabaseConfig } from "./shared";

export interface ResetCommandOptions {
  readonly seed: boolean;
}

export interface ResetCommandResult {
  readonly executed: readonly ExecutedMigration[];
  readonly seeded: readonly string[];
}

/** `warbler db:pg reset`: drops every table/enum/sequence in the `public` schema, then replays every migration from scratch. */
export async function resetCommand(layout: ProjectLayout, options: ResetCommandOptions): Promise<ResetCommandResult> {
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
    const seeded = await runSeeds(sql, { projectRoot: layout.root, path: config.migrations.seeds });
    return Object.freeze({ executed: migrated.executed, seeded: seeded.executed });
  } finally {
    await sql.close();
  }
}
