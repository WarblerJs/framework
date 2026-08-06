import type { TransactionSQL } from "bun";
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
} from "./build-ddl";
import type { PgMigrationContext } from "./types";

async function execute(tx: TransactionSQL, statements: readonly string[] | string): Promise<void> {
  for (const statement of Array.isArray(statements) ? statements : [statements]) {
    await tx.unsafe(statement);
  }
}

/** Builds the `pgm` object passed to a migration's `up`/`down` function, executing every DDL statement against `tx` as it's produced. */
export function createPgMigrationContext(tx: TransactionSQL): PgMigrationContext {
  return {
    createTable: (name, columns, options) => execute(tx, buildCreateTableSql(name, columns, options)),
    dropTable: (name, options) => execute(tx, buildDropTableSql(name, options)),
    renameTable: (from, to) => execute(tx, buildRenameTableSql(from, to)),
    addColumns: (table, columns) => execute(tx, buildAddColumnsSql(table, columns)),
    dropColumns: (table, columns) => execute(tx, buildDropColumnsSql(table, columns)),
    alterColumn: (table, column, changes) => execute(tx, buildAlterColumnSql(table, column, changes)),
    renameColumn: (table, from, to) => execute(tx, buildRenameColumnSql(table, from, to)),
    createIndex: (table, columns, options) => execute(tx, buildCreateIndexSql(table, columns, options)),
    dropIndex: (name, options) => execute(tx, buildDropIndexSql(name, options)),
    createEnum: (name, values) => execute(tx, buildCreateEnumSql(name, values)),
    dropEnum: (name, options) => execute(tx, buildDropEnumSql(name, options)),
    alterEnum: (name, changes) => execute(tx, buildAlterEnumSql(name, changes)),
    raw: (sql) => execute(tx, sql),
  };
}
