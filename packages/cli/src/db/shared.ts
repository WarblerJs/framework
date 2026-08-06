import type { DatabaseProjectConfig } from "@warbler/database";
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
  return loadDatabaseConfig(layout.root);
}
