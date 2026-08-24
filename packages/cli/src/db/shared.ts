import { DEFAULT_SEED_TABLE, SeedError, type DatabaseProjectConfig } from "@warblerjs/database";
import { loadDatabaseConfig } from "../config";
import { CLIError } from "../errors";
import type { ProjectLayout } from "../project";
import { ExitCode } from "../types";

/** Loads and validates `src/config/database.config.ts`, shared by every `db:pg` subcommand. */
export async function requireDatabaseConfig(layout: ProjectLayout): Promise<DatabaseProjectConfig> {
  const configPath = `${layout.root}/src/config/database.config.ts`;
  if (!await Bun.file(configPath).exists()) {
    throw new CLIError(
      "CLI3001",
      "src/config/database.config.ts was not found.",
      ExitCode.INVALID_PROJECT,
      "Create src/config/database.config.ts to use the database ORM.",
    );
  }
  return normalizeDatabaseConfig(await loadDatabaseConfig(layout.root));
}

function normalizeDatabaseConfig(config: DatabaseProjectConfig): DatabaseProjectConfig {
  const seedTable = config.migrations.seedTable ?? DEFAULT_SEED_TABLE;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(seedTable)) {
    throw new SeedError(seedTable, "Seed table name must be an unqualified PostgreSQL identifier.");
  }
  return Object.freeze({
    ...config,
    migrations: Object.freeze({
      ...config.migrations,
      seedTable,
      softDelete: config.migrations.softDelete ?? true,
    }),
  });
}
