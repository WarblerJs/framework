import type { SQL } from "bun";
import { pathToFileURL } from "node:url";
import { SeedError } from "../errors";
import type { PgSeed } from "./types";

export interface RunSeedsOptions {
  readonly projectRoot: string;
  readonly path: string;
}

export interface RunSeedsResult {
  readonly executed: readonly string[];
}

interface SeedFile {
  readonly name: string;
  readonly path: string;
}

interface SeedModule {
  readonly seed?: PgSeed;
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

async function discoverSeedFiles(seedsDirectory: string): Promise<readonly SeedFile[]> {
  const glob = new Bun.Glob("*.ts");
  const fileNames: string[] = [];
  for await (const fileName of glob.scan({ cwd: seedsDirectory, onlyFiles: true })) {
    fileNames.push(fileName);
  }
  fileNames.sort(compareText);
  return Object.freeze(fileNames.map((fileName) => Object.freeze({
    name: fileName.replace(/\.ts$/u, ""),
    path: `${seedsDirectory}/${fileName}`,
  })));
}

/** Runs every seed file under `options.path`, in filename order, each inside its own transaction. Unlike migrations, seeds are not tracked — every call re-runs all of them. */
export async function runSeeds(sql: SQL, options: RunSeedsOptions): Promise<RunSeedsResult> {
  const seedsDirectory = `${options.projectRoot}/${options.path}`;
  const files = await discoverSeedFiles(seedsDirectory);
  const executed: string[] = [];
  for (const file of files) {
    const module = await import(pathToFileURL(file.path).href) as SeedModule;
    if (typeof module.seed !== "function") throw new SeedError(file.name, "Seed must export a `seed` function.");
    const seed = module.seed;
    await sql.begin(async (tx) => { await seed(tx); });
    executed.push(file.name);
  }
  return Object.freeze({ executed: Object.freeze(executed) });
}
