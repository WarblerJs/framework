import type { TransactionSQL } from "bun";

/** A seed file's `seed` export. Runs inside its own transaction, unlike migrations it is not tracked and re-runs every time. */
export type PgSeed = (sql: TransactionSQL) => Promise<void> | void;
