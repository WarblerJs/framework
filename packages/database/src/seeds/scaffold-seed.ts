import { SeedError } from "../errors";

export interface ScaffoldSeedOptions {
  readonly existingFileNames?: readonly string[];
  readonly clientImportPath?: string;
}

export interface ScaffoldedSeed {
  readonly fileName: string;
  readonly content: string;
}

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const PREFIX_PATTERN = /^(\d{4,})_[a-z][a-z0-9_-]*\.seed\.ts$/u;

function seedTemplate(clientImportPath: string): string {
  return `import type { PgSeed } from "@warbler/database";
import type { WlbPgTransactionClient } from "${clientImportPath}";

export const seed: PgSeed<WlbPgTransactionClient> = async (db) => {
  // await db.user.createMany({
  //   data: [],
  // });
};
`;
}

function nextPrefix(existingFileNames: readonly string[]): number {
  let highest = 0;
  for (const fileName of existingFileNames) {
    const match = PREFIX_PATTERN.exec(fileName);
    if (match === null) continue;
    const value = Number(match[1]!);
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }
  return highest + 1;
}

/** Scaffolds a new numbered ORM-aware seed file using NNNN_name.seed.ts naming. */
export function scaffoldSeed(name: string, options: ScaffoldSeedOptions = {}): ScaffoldedSeed {
  if (!NAME_PATTERN.test(name)) {
    throw new SeedError(name, "Seed name must be lowercase and contain only letters, numbers, underscores, or hyphens.");
  }
  const prefix = nextPrefix(options.existingFileNames ?? []);
  const fileName = `${String(prefix).padStart(4, "0")}_${name}.seed.ts`;
  return Object.freeze({ fileName, content: seedTemplate(options.clientImportPath ?? "../generated/client") });
}
