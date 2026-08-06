import { SeedError } from "../errors";
import { formatTimestamp } from "../utils/timestamp";

export interface ScaffoldedSeed {
  readonly fileName: string;
  readonly content: string;
}

const TEMPLATE = `import type { PgSeed } from "@warbler/database";

export const seed: PgSeed = async (sql) => {
  // TODO: insert seed data, e.g. await sql\`INSERT INTO "table" (column) VALUES (\${"value"})\`;
};
`;

/** Scaffolds a new timestamped seed file. */
export function scaffoldSeed(name: string, now: Date = new Date()): ScaffoldedSeed {
  if (name.length === 0) throw new SeedError(name, "Seed name must not be empty.");
  const fileName = `${formatTimestamp(now)}_${name}.ts`;
  return Object.freeze({ fileName, content: TEMPLATE });
}
