import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { introspectDatabase } from "../src/introspection/introspect-database";

const TABLE_ROWS = [{ tableName: "roles" }, { tableName: "users" }, { tableName: "_wrbls_migrations" }];

const COLUMN_ROWS = [
  { tableName: "roles", columnName: "id", dataType: "uuid", udtName: "uuid", characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null, isNullable: "NO", columnDefault: "gen_random_uuid()", isIdentity: "NO" },
  { tableName: "roles", columnName: "name", dataType: "character varying", udtName: "varchar", characterMaximumLength: 50, numericPrecision: null, numericScale: null, datetimePrecision: null, isNullable: "NO", columnDefault: null, isIdentity: "NO" },
  { tableName: "users", columnName: "id", dataType: "uuid", udtName: "uuid", characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null, isNullable: "NO", columnDefault: "gen_random_uuid()", isIdentity: "NO" },
  { tableName: "users", columnName: "email", dataType: "character varying", udtName: "varchar", characterMaximumLength: 255, numericPrecision: null, numericScale: null, datetimePrecision: null, isNullable: "NO", columnDefault: null, isIdentity: "NO" },
  { tableName: "users", columnName: "age", dataType: "integer", udtName: "int4", characterMaximumLength: null, numericPrecision: 32, numericScale: 0, datetimePrecision: null, isNullable: "YES", columnDefault: null, isIdentity: "NO" },
  { tableName: "users", columnName: "status", dataType: "USER-DEFINED", udtName: "status", characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null, isNullable: "NO", columnDefault: "'active'::status", isIdentity: "NO" },
  { tableName: "users", columnName: "role_id", dataType: "uuid", udtName: "uuid", characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null, isNullable: "NO", columnDefault: null, isIdentity: "NO" },
  { tableName: "users", columnName: "deleted_at", dataType: "timestamp without time zone", udtName: "timestamp", characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: 6, isNullable: "YES", columnDefault: null, isIdentity: "NO" },
];

const INDEX_ROWS = [
  { tableName: "roles", indexName: "roles_pkey", isPrimary: true, isUnique: true, columns: ["id"], predicate: null },
  { tableName: "roles", indexName: "roles_name_key", isPrimary: false, isUnique: true, columns: ["name"], predicate: null },
  { tableName: "users", indexName: "users_pkey", isPrimary: true, isUnique: true, columns: ["id"], predicate: null },
  { tableName: "users", indexName: "users_email_key", isPrimary: false, isUnique: true, columns: ["email"], predicate: null },
  { tableName: "users", indexName: "users_email_active_key", isPrimary: false, isUnique: true, columns: ["email"], predicate: "(deleted_at IS NULL)" },
];

const FOREIGN_KEY_ROWS = [
  { tableName: "users", columnName: "role_id", referencesTable: "roles", referencesColumn: "id", onDelete: "c", onUpdate: "a" },
];

const CHECK_ROWS = [
  { tableName: "users", columnName: "age", definition: 'CHECK (("age" > 0))' },
];

const ENUM_ROWS = [
  { name: "status", value: "active" },
  { name: "status", value: "inactive" },
];

const COMMENT_ROWS = [
  { tableName: "users", columnName: "role_id", comment: "Owning role" },
];

const TABLE_COMMENT_ROWS = [
  { tableName: "users", comment: "warbler:soft-delete" },
];

function createFakeSql(): SQL {
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join("");
    if (text.includes("information_schema.tables")) return Promise.resolve(TABLE_ROWS);
    if (text.includes("information_schema.columns")) return Promise.resolve(COLUMN_ROWS);
    if (text.includes("pg_index")) return Promise.resolve(INDEX_ROWS);
    if (text.includes("con.contype = 'f'")) return Promise.resolve(FOREIGN_KEY_ROWS);
    if (text.includes("con.contype = 'c'")) return Promise.resolve(CHECK_ROWS);
    if (text.includes("pg_enum")) return Promise.resolve(ENUM_ROWS);
    if (text.includes("col_description")) return Promise.resolve(COMMENT_ROWS);
    if (text.includes("obj_description")) return Promise.resolve(TABLE_COMMENT_ROWS);
    throw new Error(`Unhandled fake query: ${text.slice(0, 80)}`);
  };
  return fn as unknown as SQL;
}

describe("introspectDatabase", () => {
  test("assembles TableMetadata from catalog rows, excluding the migrations table", async () => {
    const tables = await introspectDatabase(createFakeSql(), { excludeTables: ["_wrbls_migrations"] });

    expect(tables.map((table) => table.tableName)).toEqual(["roles", "users"]);

    const users = tables.find((table) => table.tableName === "users")!;
    expect(users.modelName).toBe("User");
    expect(users.clientKey).toBe("user");
    expect(users.primaryKey).toEqual(["id"]);

    const email = users.columns.find((column) => column.columnName === "email")!;
    expect(email.sqlType).toBe("VARCHAR(255)");
    expect(email.unique).toBe(true);

    const age = users.columns.find((column) => column.columnName === "age")!;
    expect(age.nullable).toBe(true);

    const status = users.columns.find((column) => column.columnName === "status")!;
    expect(status.pgType).toBe("enum");
    expect(status.enum).toEqual({ name: "status", values: ["active", "inactive"] });
    expect(users.enums).toEqual([{ name: "status", values: ["active", "inactive"] }]);

    const roleId = users.columns.find((column) => column.columnName === "role_id")!;
    expect(roleId.comment).toBe("Owning role");
    expect(roleId.fieldName).toBe("roleId");
    expect(email.fieldName).toBe("email");
    expect(users.foreignKeys).toEqual([
      { column: "role_id", referencesTable: "roles", referencesColumn: "id", onDelete: "CASCADE", onUpdate: "NO ACTION" },
    ]);
    expect(users.checks).toEqual([{ column: "age", expression: '("age" > 0)' }]);
    expect(users.softDelete).toEqual({ enabled: true, column: "deleted_at", field: "deletedAt" });
    expect(users.indexes.find((index) => index.name === "users_email_active_key")).toEqual({
      name: "users_email_active_key",
      column: "email",
      unique: true,
      where: [{ column: "deleted_at", operator: "isNull" }],
    });
  });

  test("does not infer soft delete from deleted_at without the explicit marker", async () => {
    const tables = await introspectDatabase(createFakeSql(), {
      excludeTables: ["_wrbls_migrations"],
      modelNames: {},
    });
    expect(tables.find((table) => table.tableName === "roles")?.softDelete).toBeUndefined();
  });

  test("consults modelNames overrides for irregular table names", async () => {
    const tables = await introspectDatabase(createFakeSql(), {
      excludeTables: ["_wrbls_migrations"],
      modelNames: { roles: "Role" },
    });
    expect(tables.find((table) => table.tableName === "roles")?.modelName).toBe("Role");
  });
});
