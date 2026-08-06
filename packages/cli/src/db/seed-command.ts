import { createPgConnection, runSeeds, scaffoldSeed } from "@warbler/database";
import { atomicWrite } from "../filesystem";
import type { ProjectLayout } from "../project";
import { requireDatabaseConfig } from "./shared";

export interface SeedRunCommandResult {
  readonly executed: readonly string[];
}

export interface SeedScaffoldCommandResult {
  readonly path: string;
}

/** `warbler db:pg seed`: runs every seed file against the live database. */
export async function seedRunCommand(layout: ProjectLayout): Promise<SeedRunCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const sql = createPgConnection(config.connection, config.log === true);
  try {
    const result = await runSeeds(sql, { projectRoot: layout.root, path: config.migrations.seeds });
    return Object.freeze({ executed: result.executed });
  } finally {
    await sql.close();
  }
}

/** `warbler db:pg seed <name>`: scaffolds a new timestamped seed file. */
export async function seedScaffoldCommand(layout: ProjectLayout, name: string): Promise<SeedScaffoldCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const { fileName, content } = scaffoldSeed(name);
  const path = await atomicWrite(layout.root, `${config.migrations.seeds}/${fileName}`, content, false);
  return Object.freeze({ path });
}
