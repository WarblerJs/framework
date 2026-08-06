import { createPgConnection, runMigrations, scaffoldMigration, type ExecutedMigration } from "@warbler/database";
import { atomicWrite } from "../filesystem";
import type { ProjectLayout } from "../project";
import { requireDatabaseConfig } from "./shared";

export interface MigrationRunCommandResult {
  readonly executed: readonly ExecutedMigration[];
}

export interface MigrationScaffoldCommandResult {
  readonly path: string;
}

/** `warbler db:pg migration`: runs every pending migration against the live database. */
export async function migrationRunCommand(layout: ProjectLayout): Promise<MigrationRunCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const sql = createPgConnection(config.connection, config.log === true);
  try {
    const result = await runMigrations(sql, {
      projectRoot: layout.root,
      path: config.migrations.path,
      table: config.migrations.table,
    });
    return Object.freeze({ executed: result.executed });
  } finally {
    await sql.close();
  }
}

/** `warbler db:pg migration <kind>:<name>`: scaffolds a new timestamped migration file. */
export async function migrationScaffoldCommand(layout: ProjectLayout, arg: string): Promise<MigrationScaffoldCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const { fileName, content } = scaffoldMigration(arg);
  const path = await atomicWrite(layout.root, `${config.migrations.path}/${fileName}`, content, false);
  return Object.freeze({ path });
}
