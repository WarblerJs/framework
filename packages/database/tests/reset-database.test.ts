import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { resetDatabase } from "../src/migrations/reset-database";

describe("resetDatabase", () => {
  test("drops and recreates the public schema, in that order", async () => {
    const statements: string[] = [];
    const sql = { unsafe: async (query: string) => { statements.push(query); return []; } } as unknown as SQL;

    await resetDatabase(sql);

    expect(statements).toEqual(["DROP SCHEMA public CASCADE", "CREATE SCHEMA public"]);
  });
});
