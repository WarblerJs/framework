import { describe, expect, test } from "bun:test";
import { scaffoldMigration } from "../src/migrations/scaffold-migration";
import { MigrationScaffoldError } from "../src/errors";

const FIXED_DATE = new Date(Date.UTC(2026, 7, 5, 14, 30, 25));

describe("scaffoldMigration", () => {
  test("produces the spec's exact filename shape", () => {
    const { fileName } = scaffoldMigration("create:table:user", FIXED_DATE);
    expect(fileName).toBe("20260805143025_create_table_user.ts");
  });

  test("every supported kind scaffolds valid-looking content and a matching filename", () => {
    const kinds = [
      "create:table:user",
      "alter:table:user",
      "rename:table:user",
      "drop:table:user",
      "add:column:user_email",
      "alter:column:user_email",
      "rename:column:user_email",
      "drop:column:user_email",
      "create:index:user_email",
      "create:unique:index:user_email",
      "drop:index:user_email",
      "create:enum:user_status",
      "alter:enum:user_status",
      "raw:custom:backfill",
    ];
    for (const arg of kinds) {
      const { fileName, content } = scaffoldMigration(arg, FIXED_DATE);
      expect(fileName).toBe(`20260805143025_${arg.replaceAll(":", "_")}.ts`);
      expect(content).toContain('import type { PgMigration } from "@warbler/database"');
      expect(content).toContain("export const up: PgMigration");
      expect(content).toContain("export const down: PgMigration");
    }
  });

  test("create:table pluralizes the given name into the table argument", () => {
    const { content } = scaffoldMigration("create:table:user", FIXED_DATE);
    expect(content).toContain('pgm.createTable("users"');
    expect(content).toContain('pgm.dropTable("users")');
  });

  test("rejects an unknown kind", () => {
    expect(() => scaffoldMigration("frobnicate:user", FIXED_DATE)).toThrow(MigrationScaffoldError);
  });

  test("rejects a kind with no name", () => {
    expect(() => scaffoldMigration("create:table:", FIXED_DATE)).toThrow(MigrationScaffoldError);
  });
});
