import { describe, expect, test } from "bun:test";
import { generateSchemaSql } from "../src/schema/generate-schema-sql";
import type { TableMetadata } from "../src/types/model.types";

function fixtureTables(): readonly TableMetadata[] {
  const roles: TableMetadata = Object.freeze({
    modelName: "Role",
    clientKey: "role",
    tableName: "roles",
    columns: Object.freeze([
      Object.freeze({
        fieldName: "id", columnName: "id", pgType: "uuid", sqlType: "UUID",
        nullable: false, default: Object.freeze({ raw: "gen_random_uuid()" }),
        unique: false, primaryKey: true, identity: false, index: false,
      }),
      Object.freeze({
        fieldName: "name", columnName: "name", pgType: "varchar", sqlType: "VARCHAR(50)",
        nullable: false, unique: true, primaryKey: false, identity: false, index: false,
      }),
    ]),
    primaryKey: Object.freeze(["id"]),
    indexes: Object.freeze([{ name: "roles_name_key", column: "name", unique: true }]),
    foreignKeys: Object.freeze([]),
    checks: Object.freeze([]),
    enums: Object.freeze([]),
  });

  const users: TableMetadata = Object.freeze({
    modelName: "User",
    clientKey: "user",
    tableName: "users",
    columns: Object.freeze([
      Object.freeze({
        fieldName: "id", columnName: "id", pgType: "uuid", sqlType: "UUID",
        nullable: false, default: Object.freeze({ raw: "gen_random_uuid()" }),
        unique: false, primaryKey: true, identity: false, index: false,
      }),
      Object.freeze({
        fieldName: "email", columnName: "email", pgType: "varchar", sqlType: "VARCHAR(255)",
        nullable: false, unique: true, primaryKey: false, identity: false, index: false,
      }),
      Object.freeze({
        fieldName: "age", columnName: "age", pgType: "integer", sqlType: "INTEGER",
        nullable: true, unique: false, primaryKey: false, identity: false, index: false,
      }),
      Object.freeze({
        fieldName: "status", columnName: "status", pgType: "enum", sqlType: "status",
        nullable: false, default: "active", unique: false, primaryKey: false, identity: false, index: false,
        enum: Object.freeze({ name: "status", values: Object.freeze(["active", "inactive"]) }),
      }),
      Object.freeze({
        fieldName: "roleId", columnName: "role_id", pgType: "uuid", sqlType: "UUID",
        nullable: false, unique: false, primaryKey: false, identity: false, index: true,
        comment: "Owning role",
      }),
    ]),
    primaryKey: Object.freeze(["id"]),
    indexes: Object.freeze([
      { name: "users_email_key", column: "email", unique: true },
      { name: "users_role_id_idx", column: "role_id", unique: false },
    ]),
    foreignKeys: Object.freeze([
      { column: "role_id", referencesTable: "roles", referencesColumn: "id", onDelete: "CASCADE" as const },
    ]),
    checks: Object.freeze([{ column: "age", expression: '"age" > 0' }]),
    enums: Object.freeze([{ name: "status", values: Object.freeze(["active", "inactive"]) }]),
  });

  return Object.freeze([roles, users]);
}

describe("generateSchemaSql", () => {
  test("is deterministic across repeated runs", () => {
    const tables = fixtureTables();
    expect(generateSchemaSql(tables)).toBe(generateSchemaSql(tables));
  });

  test("orders tables alphabetically and emits enum types before tables", () => {
    const sql = generateSchemaSql(fixtureTables());
    const enumIndex = sql.indexOf('CREATE TYPE "status"');
    const roleIndex = sql.indexOf('CREATE TABLE "roles"');
    const userIndex = sql.indexOf('CREATE TABLE "users"');
    expect(enumIndex).toBeGreaterThan(-1);
    expect(enumIndex).toBeLessThan(roleIndex);
    expect(roleIndex).toBeLessThan(userIndex);
  });

  test("renders NOT NULL, DEFAULT, PRIMARY KEY, CHECK, FOREIGN KEY, UNIQUE index, and COMMENT", () => {
    const sql = generateSchemaSql(fixtureTables());
    expect(sql).toContain('"email" VARCHAR(255) NOT NULL');
    expect(sql).toContain('PRIMARY KEY ("id")');
    expect(sql).toContain('CHECK ("age" > 0)');
    expect(sql).toContain('FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE');
    expect(sql).toContain('CREATE UNIQUE INDEX "users_email_key" ON "users" ("email")');
    expect(sql).toContain('CREATE INDEX "users_role_id_idx" ON "users" ("role_id")');
    expect(sql).toContain('COMMENT ON COLUMN "users"."role_id" IS \'Owning role\'');
    expect(sql).toContain("DEFAULT gen_random_uuid()");
    expect(sql).toContain("DEFAULT 'active'");
  });
});
