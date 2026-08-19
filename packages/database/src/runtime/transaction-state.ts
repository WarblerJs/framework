import type { SQL, TransactionSQL } from "bun";

const ACTIVE_TRANSACTION_SQL = new WeakMap<object, () => boolean>();

export function markTransactionSql(sql: TransactionSQL, isActive: () => boolean): TransactionSQL {
  ACTIVE_TRANSACTION_SQL.set(sql as unknown as object, isActive);
  return sql;
}

export function isActiveTransactionSql(sql: SQL): boolean {
  return ACTIVE_TRANSACTION_SQL.get(sql as unknown as object)?.() === true;
}
