import { createPgConnection, generateFromDatabase } from "@warblerjs/database";
import { loadDatabaseConfig } from "../config";
import { CLIError } from "../errors";
import type { ProjectLayout } from "../project";
import { ExitCode } from "../types";

/** Result of `warbler db:pg generate`. */
export interface DatabaseGenerateResult {
  readonly tables: readonly string[];
  readonly fingerprint: string;
}

/** Connects to the live database, introspects it, and writes schema.sql/metadata.json/the generated client. */
export async function databaseGenerateCommand(layout: ProjectLayout): Promise<DatabaseGenerateResult> {
  const configPath = `${layout.root}/src/config/database.config.ts`;
  if (!await Bun.file(configPath).exists()) {
    throw new CLIError(
      "CLI3001",
      "src/config/database.config.ts was not found.",
      ExitCode.INVALID_PROJECT,
      "Create src/config/database.config.ts to use the database ORM.",
    );
  }
  const config = await loadDatabaseConfig(layout.root);
  const sql = createPgConnection(config.connection, config.log === true);
  try {
    const result = await generateFromDatabase(sql, { projectRoot: layout.root, config });
    return Object.freeze({
      tables: result.artifact.tables.map((table) => table.tableName),
      fingerprint: result.artifact.fingerprint,
    });
  } finally {
    await sql.close();
  }
}
