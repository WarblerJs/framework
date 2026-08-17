import type { SQL } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { createCompiledDatabaseArtifact, type CompiledDatabaseArtifact } from "../artifact";
import { generateClientBarrelSource, generateClientSource } from "../generator/generate-client";
import { generateModelMirrorSource } from "../generator/generate-model-mirror";
import { generateRuntimeClientSource } from "../generator/generate-runtime";
import { generateSchemaSql } from "../schema/generate-schema-sql";
import type { DatabaseProjectConfig } from "../types/config.types";
import { introspectDatabase } from "./introspect-database";

export interface GenerateFromDatabaseOptions {
  readonly projectRoot: string;
  readonly config: DatabaseProjectConfig;
}

export interface DatabaseGenerationResult {
  readonly artifact: CompiledDatabaseArtifact;
}

async function resetGeneratedDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

/** Introspects the live database and writes schema.sql/metadata.json/runtime/client/models into `config.migrations.generated`. */
export async function generateFromDatabase(sql: SQL, options: GenerateFromDatabaseOptions): Promise<DatabaseGenerationResult> {
  const { projectRoot, config } = options;
  const tables = await introspectDatabase(sql, {
    excludeTables: [config.migrations.table],
    ...(config.migrations.modelNames === undefined ? {} : { modelNames: config.migrations.modelNames }),
  });
  const artifact = createCompiledDatabaseArtifact({ tables });

  const generatedRoot = `${projectRoot}/${config.migrations.generated}`;
  await resetGeneratedDirectory(`${generatedRoot}/client`);
  await resetGeneratedDirectory(`${generatedRoot}/models`);
  await mkdir(`${generatedRoot}/runtime`, { recursive: true });
  await Bun.write(`${generatedRoot}/schema.sql`, generateSchemaSql(tables));
  await Bun.write(`${generatedRoot}/metadata.json`, `${JSON.stringify(tables, null, 2)}\n`);
  await Bun.write(`${generatedRoot}/runtime/pg-client.ts`, generateRuntimeClientSource(config));
  for (const table of tables) {
    await Bun.write(`${generatedRoot}/client/${table.clientKey}.ts`, generateClientSource(table));
    await Bun.write(`${generatedRoot}/models/${table.modelName}.ts`, generateModelMirrorSource(table));
  }
  await Bun.write(`${generatedRoot}/client/index.ts`, generateClientBarrelSource(tables));

  return Object.freeze({ artifact });
}
