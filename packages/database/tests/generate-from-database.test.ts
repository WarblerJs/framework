import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { generateFromDatabase } from "../src/introspection/generate-from-database";
import type { DatabaseProjectConfig } from "../src/types/config.types";

const TABLE_ROWS = [{ tableName: "users" }, { tableName: "_wrbls_migrations" }];
const COLUMN_ROWS = [
  {
    tableName: "users",
    columnName: "id",
    dataType: "uuid",
    udtName: "uuid",
    characterMaximumLength: null,
    numericPrecision: null,
    numericScale: null,
    datetimePrecision: null,
    isNullable: "NO",
    columnDefault: "gen_random_uuid()",
    isIdentity: "NO",
  },
];
const INDEX_ROWS = [{ tableName: "users", indexName: "users_pkey", isPrimary: true, isUnique: true, columns: ["id"] }];

function createFakeSql(): SQL {
  const sql = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join("");
    if (text.includes("information_schema.tables")) return Promise.resolve(TABLE_ROWS);
    if (text.includes("information_schema.columns")) return Promise.resolve(COLUMN_ROWS);
    if (text.includes("pg_index")) return Promise.resolve(INDEX_ROWS);
    if (text.includes("con.contype = 'f'")) return Promise.resolve([]);
    if (text.includes("con.contype = 'c'")) return Promise.resolve([]);
    if (text.includes("pg_enum")) return Promise.resolve([]);
    if (text.includes("col_description")) return Promise.resolve([]);
    throw new Error(`Unhandled fake query: ${text.slice(0, 80)}`);
  };
  return sql as unknown as SQL;
}

const config: DatabaseProjectConfig = Object.freeze({
  connection: Object.freeze({}),
  migrations: Object.freeze({
    table: "_wrbls_migrations",
    generated: "database/warbler/pg/generated",
    path: "database/warbler/pg/migrations",
    seeds: "database/warbler/pg/seeds",
  }),
});

describe("generateFromDatabase", () => {
  test("removes stale generated client and model files for dropped tables", async () => {
    const root = `/tmp/warbler-database-generate-${crypto.randomUUID()}`;
    const generated = `${root}/database/warbler/pg/generated`;
    await Bun.write(`${generated}/client/session.ts`, "stale session client");
    await Bun.write(`${generated}/client/index.ts`, 'import * as sessionClient from "./session";\n');
    await Bun.write(`${generated}/models/Session.ts`, "stale session model");

    const result = await generateFromDatabase(createFakeSql(), { projectRoot: root, config });

    expect(result.artifact.tables.map((table) => table.tableName)).toEqual(["users"]);
    expect(await Bun.file(`${generated}/client/session.ts`).exists()).toBe(false);
    expect(await Bun.file(`${generated}/models/Session.ts`).exists()).toBe(false);
    const index = await Bun.file(`${generated}/client/index.ts`).text();
    expect(index).toContain('import * as userClient from "./user";');
    expect(index).toContain("interface WlbPgDelegates<Database extends SQL>");
    expect(index).toContain("readonly db: Database;");
    expect(index).toContain("export type WlbPgTransactionClient = Readonly<WlbPgDelegates<TransactionSQL>>;");
    expect(index).toContain("readonly transaction: typeof transaction;");
    expect(index).toContain("db: database,");
    expect(index).toContain("return executeTransaction(pg, (tx) => callback(createClient(tx)), options);");
    expect(index).not.toContain("session");

    const userClient = await Bun.file(`${generated}/client/user.ts`).text();
    expect(userClient).toContain("export interface UserDelegate");
    expect(userClient).toContain("export function createUserDelegate(database: SQL): UserDelegate");
  });
});
