import { DEFAULT_SEED_TABLE, createPgConnection, runSeeds, scaffoldSeed, type ExecutedSeed } from "@warblerjs/database";
import type { TransactionSQL } from "bun";
import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, pathExists, resolveInside } from "../filesystem";
import { CLIError } from "../errors";
import type { ProjectLayout } from "../project";
import { ExitCode } from "../types";
import { requireDatabaseConfig } from "./shared";

export type SeedClientFactory = (tx: TransactionSQL) => unknown;

export interface SeedRunCommandOptions {
  readonly only?: string;
  readonly confirm?: (pending: readonly string[]) => boolean | Promise<boolean>;
}

export interface SeedRunCommandResult {
  readonly executed: readonly ExecutedSeed[];
  readonly skipped: readonly string[];
  readonly pending: readonly string[];
  readonly canceled: boolean;
  readonly alreadyExecuted?: string;
}

export interface SeedScaffoldCommandResult {
  readonly path: string;
}

interface GeneratedClientModule {
  readonly createWlbPgClient?: unknown;
}

function seedTableName(config: Awaited<ReturnType<typeof requireDatabaseConfig>>): string {
  return config.migrations.seedTable ?? DEFAULT_SEED_TABLE;
}

function toImportSpecifier(fromDirectory: string, targetPath: string): string {
  const specifier = relative(fromDirectory, targetPath).replaceAll("\\", "/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

async function seedFileNames(root: string, relativeDirectory: string): Promise<readonly string[]> {
  const directory = resolveInside(root, relativeDirectory);
  if (!await pathExists(directory)) return Object.freeze([]);
  return Object.freeze((await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name));
}

export async function loadSeedClientFactory(layout: ProjectLayout, generatedPath: string): Promise<SeedClientFactory> {
  const clientPath = resolveInside(layout.root, `${generatedPath}/client/factory.ts`);
  if (!await pathExists(clientPath)) {
    throw new CLIError("CLI3005", "Generated PostgreSQL client was not found.", ExitCode.INVALID_PROJECT, "Run warbler db:pg generate before running seeds.");
  }
  const module = await import(pathToFileURL(clientPath).href) as GeneratedClientModule;
  if (typeof module.createWlbPgClient !== "function") {
    throw new CLIError("CLI3006", "Generated PostgreSQL client does not export createWlbPgClient.", ExitCode.INVALID_PROJECT, "Run warbler db:pg generate before running seeds.");
  }
  return module.createWlbPgClient as SeedClientFactory;
}

export function createLazySeedClientFactory(layout: ProjectLayout, generatedPath: string): (tx: TransactionSQL) => Promise<unknown> {
  let factory: Promise<SeedClientFactory> | undefined;
  return async (tx) => {
    factory ??= loadSeedClientFactory(layout, generatedPath);
    return (await factory)(tx);
  };
}

/** `warbler db:pg seed:run`: runs pending tracked seed files against the live database. */
export async function seedRunCommand(layout: ProjectLayout, options: SeedRunCommandOptions = {}): Promise<SeedRunCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const sql = createPgConnection(config.connection, config.log === true);
  try {
    const result = await runSeeds(sql, {
      projectRoot: layout.root,
      path: config.migrations.seeds,
      table: seedTableName(config),
      ...(options.only === undefined ? {} : { only: options.only }),
      createClient: createLazySeedClientFactory(layout, config.migrations.generated),
      ...(options.confirm === undefined ? {} : { confirm: (pending) => options.confirm!(pending.map((file) => file.name)) }),
    });
    return Object.freeze(result);
  } finally {
    await sql.close();
  }
}

/** `warbler db:pg seed:make <name>`: scaffolds a new numbered ORM-aware seed file. */
export async function seedScaffoldCommand(layout: ProjectLayout, name: string): Promise<SeedScaffoldCommandResult> {
  const config = await requireDatabaseConfig(layout);
  const seedsDirectory = resolveInside(layout.root, config.migrations.seeds);
  const generatedClient = resolveInside(layout.root, `${config.migrations.generated}/client`);
  const { fileName, content } = scaffoldSeed(name, {
    existingFileNames: await seedFileNames(layout.root, config.migrations.seeds),
    clientImportPath: toImportSpecifier(seedsDirectory, generatedClient),
  });
  const path = await atomicWrite(layout.root, `${config.migrations.seeds}/${fileName}`, content, false);
  return Object.freeze({ path });
}
