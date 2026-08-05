import { describe, expect, test } from "bun:test";
import {
  buildAddColumnsSql,
  buildAlterColumnSql,
  buildAlterEnumSql,
  buildCreateEnumSql,
  buildCreateIndexSql,
  buildCreateTableSql,
  buildDropColumnsSql,
  buildDropEnumSql,
  buildDropIndexSql,
  buildDropTableSql,
  buildRenameColumnSql,
  buildRenameTableSql,
} from "../src/migrations/build-ddl";
import { PgCheck } from "../src/columns/pg-check";
import { PgDefault } from "../src/columns/pg-default";
import { PgTypes } from "../src/columns/pg-types";
import { OnDeleteAction } from "../src/columns/on-delete.types";
import { DatabaseCompileError } from "../src/errors";

describe("build-ddl", () => {
  test("createTable renders columns, PRIMARY KEY, CHECK, FOREIGN KEY, and trailing index/comment statements", () => {
    const statements = buildCreateTableSql("users", {
      id: PgTypes.Uuid({ primaryKey: true, default: PgDefault.GenRandomUuid }),
      email: PgTypes.VarChar({ length: 255, nullable: false, unique: true }),
      age: PgTypes.Integer({ nullable: true, check: PgCheck.gt(0) }),
      roleId: PgTypes.Uuid({
        nullable: false,
        references: { table: "roles", column: "id" },
        onDelete: OnDeleteAction.Cascade,
        index: true,
        comment: "Owning role",
      }),
    });
    expect(statements[0]).toContain('CREATE TABLE "users" (');
    expect(statements[0]).toContain('"id" UUID NOT NULL DEFAULT gen_random_uuid()');
    expect(statements[0]).toContain('PRIMARY KEY ("id")');
    expect(statements[0]).toContain('CHECK ("age" > 0)');
    expect(statements[0]).toContain('FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE');
    expect(statements).toContain('CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");');
    expect(statements).toContain('CREATE INDEX "users_role_id_idx" ON "users" ("role_id");');
    expect(statements).toContain('COMMENT ON COLUMN "users"."role_id" IS \'Owning role\';');
  });

  test("createTable honors ifNotExists", () => {
    const [statement] = buildCreateTableSql("users", { id: PgTypes.Uuid() }, { ifNotExists: true });
    expect(statement).toContain('CREATE TABLE IF NOT EXISTS "users"');
  });

  test("dropTable honors ifExists and cascade", () => {
    expect(buildDropTableSql("users")).toBe('DROP TABLE "users";');
    expect(buildDropTableSql("users", { ifExists: true, cascade: true })).toBe('DROP TABLE IF EXISTS "users" CASCADE;');
  });

  test("renameTable", () => {
    expect(buildRenameTableSql("old_users", "users")).toBe('ALTER TABLE "old_users" RENAME TO "users";');
  });

  test("addColumns rejects a primaryKey column", () => {
    expect(() => buildAddColumnsSql("users", { id: PgTypes.Uuid({ primaryKey: true }) })).toThrow(DatabaseCompileError);
  });

  test("addColumns renders one ADD COLUMN per column plus constraints", () => {
    const statements = buildAddColumnsSql("users", {
      bio: PgTypes.Text({ nullable: true }),
      roleId: PgTypes.Uuid({ references: { table: "roles", column: "id" } }),
    });
    expect(statements).toContain('ALTER TABLE "users" ADD COLUMN "bio" TEXT;');
    expect(statements.some((s) => s.includes('ADD CONSTRAINT "users_role_id_fkey"'))).toBe(true);
  });

  test("dropColumns", () => {
    expect(buildDropColumnsSql("users", ["bio", "age"])).toEqual([
      'ALTER TABLE "users" DROP COLUMN "bio";',
      'ALTER TABLE "users" DROP COLUMN "age";',
    ]);
    expect(() => buildDropColumnsSql("users", [])).toThrow(DatabaseCompileError);
  });

  test("renameColumn", () => {
    expect(buildRenameColumnSql("users", "bio", "biography")).toBe('ALTER TABLE "users" RENAME COLUMN "bio" TO "biography";');
  });

  test("alterColumn combines type/nullable/default clauses in one statement", () => {
    expect(buildAlterColumnSql("users", "bio", { nullable: true })).toBe('ALTER TABLE "users" ALTER COLUMN "bio" DROP NOT NULL;');
    expect(buildAlterColumnSql("users", "bio", { default: null })).toBe('ALTER TABLE "users" ALTER COLUMN "bio" DROP DEFAULT;');
    expect(buildAlterColumnSql("users", "bio", { default: "n/a" })).toBe("ALTER TABLE \"users\" ALTER COLUMN \"bio\" SET DEFAULT 'n/a';");
    expect(buildAlterColumnSql("users", "bio", { type: PgTypes.VarChar(500), nullable: false })).toBe(
      'ALTER TABLE "users" ALTER COLUMN "bio" TYPE VARCHAR(500) USING "bio"::VARCHAR(500), ALTER COLUMN "bio" SET NOT NULL;',
    );
    expect(() => buildAlterColumnSql("users", "bio", {})).toThrow(DatabaseCompileError);
  });

  test("createIndex derives a deterministic name when none is given", () => {
    expect(buildCreateIndexSql("users", ["email"])).toBe('CREATE INDEX "users_email_idx" ON "users" ("email");');
    expect(buildCreateIndexSql("users", ["email"], { unique: true })).toBe('CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");');
    expect(buildCreateIndexSql("users", ["email"], { name: "custom_idx" })).toContain('"custom_idx"');
    expect(() => buildCreateIndexSql("users", [])).toThrow(DatabaseCompileError);
  });

  test("dropIndex honors ifExists", () => {
    expect(buildDropIndexSql("users_email_idx")).toBe('DROP INDEX "users_email_idx";');
    expect(buildDropIndexSql("users_email_idx", { ifExists: true })).toBe('DROP INDEX IF EXISTS "users_email_idx";');
  });

  test("createEnum / dropEnum / alterEnum", () => {
    expect(buildCreateEnumSql("status", ["active", "inactive"])).toBe("CREATE TYPE \"status\" AS ENUM ('active', 'inactive');");
    expect(() => buildCreateEnumSql("status", [])).toThrow(DatabaseCompileError);
    expect(buildDropEnumSql("status", { ifExists: true })).toBe('DROP TYPE IF EXISTS "status";');
    expect(buildAlterEnumSql("status", { addValues: ["pending"] })).toEqual(["ALTER TYPE \"status\" ADD VALUE 'pending';"]);
    expect(() => buildAlterEnumSql("status", { addValues: [] })).toThrow(DatabaseCompileError);
  });
});
