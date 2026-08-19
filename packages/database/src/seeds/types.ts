import type { TransactionSQL } from "bun";

/** A seed file's named `seed` export. Runs inside one transaction and receives the project generated transaction client. */
export type PgSeed<Database = TransactionSQL> = (db: Database) => Promise<void> | void;
