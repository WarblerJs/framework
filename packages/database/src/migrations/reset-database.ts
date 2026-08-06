import type { SQL } from "bun";

/** Drops and recreates the `public` schema, permanently removing every table, enum, sequence, and index in it — including the migrations table. */
export async function resetDatabase(sql: SQL): Promise<void> {
  await sql.unsafe("DROP SCHEMA public CASCADE");
  await sql.unsafe("CREATE SCHEMA public");
}
