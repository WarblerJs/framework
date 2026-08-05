import type { ColumnBuilder, ColumnValue } from "../types/column.types";
import type { PgDefaultTypes } from "../columns/pg-default";

export interface AlterColumnChanges {
  readonly type?: ColumnBuilder;
  readonly nullable?: boolean;
  /** `null` drops the default; `undefined` (the default) leaves it unchanged. */
  readonly default?: PgDefaultTypes | string | number | boolean | null;
}

export interface CreateIndexOptions {
  readonly unique?: boolean;
  readonly name?: string;
}

export interface DropOptions {
  readonly ifExists?: boolean;
}

export interface CreateTableOptions {
  readonly ifNotExists?: boolean;
}

export interface DropTableOptions extends DropOptions {
  readonly cascade?: boolean;
}

export interface AlterEnumChanges {
  readonly addValues: readonly string[];
}

/** The typed migration DSL passed to every `up`/`down` function. Every method executes immediately, inside the migration's transaction. */
export interface PgMigrationContext {
  createTable(name: string, columns: Readonly<Record<string, ColumnValue>>, options?: CreateTableOptions): Promise<void>;
  dropTable(name: string, options?: DropTableOptions): Promise<void>;
  renameTable(from: string, to: string): Promise<void>;
  addColumns(table: string, columns: Readonly<Record<string, ColumnValue>>): Promise<void>;
  dropColumns(table: string, columns: readonly string[]): Promise<void>;
  alterColumn(table: string, column: string, changes: AlterColumnChanges): Promise<void>;
  renameColumn(table: string, from: string, to: string): Promise<void>;
  createIndex(table: string, columns: readonly string[], options?: CreateIndexOptions): Promise<void>;
  dropIndex(name: string, options?: DropOptions): Promise<void>;
  createEnum(name: string, values: readonly string[]): Promise<void>;
  dropEnum(name: string, options?: DropOptions): Promise<void>;
  alterEnum(name: string, changes: AlterEnumChanges): Promise<void>;
  raw(sql: string): Promise<void>;
}

/** A migration file's `up`/`down` export. */
export type PgMigration = (pgm: PgMigrationContext) => Promise<void> | void;
