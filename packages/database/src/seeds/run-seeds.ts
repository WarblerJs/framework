import type { SQL, TransactionSQL } from "bun";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SeedError } from "../errors";
import { compareText, nextBatch } from "../migrations/internal";
import { executeTransaction } from "../runtime/transaction-query";
import { quoteIdentifier } from "../utils/sql-identifier";
import type { PgSeed } from "./types";

export const DEFAULT_SEED_TABLE = "_warbler_seeds";

export interface RunSeedsOptions<Database = TransactionSQL> {
  readonly projectRoot: string;
  readonly path: string;
  readonly table?: string;
  readonly only?: string;
  readonly createClient?: (tx: TransactionSQL) => Database | Promise<Database>;
  readonly confirm?: (pending: readonly SeedFile[]) => boolean | Promise<boolean>;
}

export interface ExecutedSeed {
  readonly name: string;
  readonly batch: number;
}

export interface RunSeedsResult {
  readonly executed: readonly ExecutedSeed[];
  readonly skipped: readonly string[];
  readonly pending: readonly string[];
  readonly canceled: boolean;
  readonly alreadyExecuted?: string;
}

export interface SeedFile {
  readonly name: string;
  readonly logicalName: string;
  readonly prefix: number;
  readonly path: string;
}

interface SeedModule<Database> {
  readonly seed?: PgSeed<Database>;
}

const SEED_FILE_PATTERN = /^(\d{4,})_([a-z][a-z0-9_-]*)\.seed\.ts$/u;
const SEED_LOGICAL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const SEED_TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function assertSeedTableName(table: string): void {
  if (!SEED_TABLE_PATTERN.test(table)) {
    throw new SeedError(table, "Seed table name must be an unqualified PostgreSQL identifier.");
  }
}

function parseSeedFile(fileName: string): SeedFile {
  const match = SEED_FILE_PATTERN.exec(fileName);
  if (match === null) throw new SeedError(fileName, "Seed files must be named NNNN_name.seed.ts.");
  return Object.freeze({
    name: fileName,
    logicalName: match[2]!,
    prefix: Number(match[1]!),
    path: "",
  });
}

function withPath(file: SeedFile, seedsDirectory: string): SeedFile {
  return Object.freeze({ ...file, path: `${seedsDirectory}/${file.name}` });
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}

export async function discoverSeedFiles(seedsDirectory: string): Promise<readonly SeedFile[]> {
  if (!await directoryExists(seedsDirectory)) return Object.freeze([]);
  const glob = new Bun.Glob("*.seed.ts");
  const fileNames: string[] = [];
  for await (const fileName of glob.scan({ cwd: seedsDirectory, onlyFiles: true })) {
    fileNames.push(fileName);
  }
  fileNames.sort(compareText);
  return Object.freeze(fileNames.map((fileName) => withPath(parseSeedFile(fileName), seedsDirectory)));
}

export async function ensureSeedsTable(sql: SQL, table = DEFAULT_SEED_TABLE): Promise<void> {
  assertSeedTableName(table);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      batch INTEGER NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function loadExecutedSeeds(sql: SQL, table: string): Promise<ReadonlySet<string>> {
  const rows = await sql.unsafe<{ name: string }[]>(`SELECT name FROM ${quoteIdentifier(table)}`);
  return new Set(rows.map((row) => row.name));
}

function selectOnlySeed(files: readonly SeedFile[], logicalName: string): SeedFile {
  if (!SEED_LOGICAL_NAME_PATTERN.test(logicalName)) throw new SeedError(logicalName, "Seed logical name is invalid.");
  const matches = files.filter((file) => file.logicalName === logicalName);
  if (matches.length === 0) throw new SeedError(logicalName, `No seed file matches "${logicalName}".`);
  if (matches.length > 1) throw new SeedError(logicalName, `Seed logical name "${logicalName}" is ambiguous.`);
  return matches[0]!;
}

async function recordSeedExecution(tx: TransactionSQL, table: string, name: string, batch: number): Promise<void> {
  await tx.unsafe(`INSERT INTO ${quoteIdentifier(table)} (name, batch) VALUES ($1, $2)`, [name, batch]);
}

/** Runs pending NNNN_name.seed.ts files in deterministic order, tracking each successful seed in the configured PostgreSQL table. */
export async function runSeeds<Database = TransactionSQL>(sql: SQL, options: RunSeedsOptions<Database>): Promise<RunSeedsResult> {
  const table = options.table ?? DEFAULT_SEED_TABLE;
  assertSeedTableName(table);
  const seedsDirectory = `${options.projectRoot}/${options.path}`;
  const files = await discoverSeedFiles(seedsDirectory);

  await ensureSeedsTable(sql, table);
  const executedByName = await loadExecutedSeeds(sql, table);
  const selected = options.only === undefined ? files : [selectOnlySeed(files, options.only)];

  if (options.only !== undefined && executedByName.has(selected[0]!.name)) {
    return Object.freeze({
      executed: Object.freeze([]),
      skipped: Object.freeze([selected[0]!.name]),
      pending: Object.freeze([]),
      canceled: false,
      alreadyExecuted: selected[0]!.name,
    });
  }

  const pending = selected.filter((file) => !executedByName.has(file.name));
  if (pending.length === 0) {
    return Object.freeze({
      executed: Object.freeze([]),
      skipped: Object.freeze(files.filter((file) => executedByName.has(file.name)).map((file) => file.name)),
      pending: Object.freeze([]),
      canceled: false,
    });
  }

  if (options.confirm !== undefined && !await options.confirm(pending)) {
    return Object.freeze({
      executed: Object.freeze([]),
      skipped: Object.freeze([]),
      pending: Object.freeze(pending.map((file) => file.name)),
      canceled: true,
    });
  }

  const batch = await nextBatch(sql, table);
  const executed: ExecutedSeed[] = [];
  for (const file of pending) {
    const module = await import(pathToFileURL(file.path).href) as SeedModule<Database>;
    if (typeof module.seed !== "function") throw new SeedError(file.name, "Seed must export a named `seed` function.");
    const seed = module.seed;
    await executeTransaction(sql, async (tx) => {
      const db = options.createClient === undefined ? tx as unknown as Database : await options.createClient(tx);
      await seed(db);
      await recordSeedExecution(tx, table, file.name, batch);
      executed.push(Object.freeze({ name: file.name, batch }));
    });
  }

  return Object.freeze({
    executed: Object.freeze(executed),
    skipped: Object.freeze(files.filter((file) => executedByName.has(file.name)).map((file) => file.name)),
    pending: Object.freeze([]),
    canceled: false,
  });
}
