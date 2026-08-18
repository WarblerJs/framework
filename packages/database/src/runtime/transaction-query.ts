import type { SQL, TransactionSQL } from "bun";
import { DatabaseTransactionError } from "../errors";
import { isPlainObject } from "./read-query";

export type TransactionIsolationLevel = "readCommitted" | "repeatableRead" | "serializable";

export interface TransactionOptions {
  readonly isolationLevel?: TransactionIsolationLevel;
  readonly timeout?: number;
  readonly readOnly?: boolean;
}

interface TransactionState {
  active: boolean;
}

const ISOLATION_SQL: Readonly<Record<TransactionIsolationLevel, string>> = Object.freeze({
  readCommitted: "isolation level read committed",
  repeatableRead: "isolation level repeatable read",
  serializable: "isolation level serializable",
});

function validateTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new DatabaseTransactionError("invalid-options", "`timeout` must be a positive finite safe integer in milliseconds.");
  }
  return value;
}

function validateOptions(options: TransactionOptions | undefined): { readonly beginOptions: string | undefined; readonly timeout: number | undefined } {
  if (options === undefined) return { beginOptions: undefined, timeout: undefined };
  if (!isPlainObject(options)) throw new DatabaseTransactionError("invalid-options", "Options must be an object.");

  const timeout = validateTimeout(options.timeout);
  const parts: string[] = [];
  if (options.isolationLevel !== undefined) {
    const level = options.isolationLevel;
    if (level !== "readCommitted" && level !== "repeatableRead" && level !== "serializable") {
      throw new DatabaseTransactionError("invalid-options", "`isolationLevel` must be readCommitted, repeatableRead, or serializable.");
    }
    parts.push(ISOLATION_SQL[level]);
  }
  if (options.readOnly !== undefined) {
    if (typeof options.readOnly !== "boolean") throw new DatabaseTransactionError("invalid-options", "`readOnly` must be a boolean.");
    parts.push(options.readOnly ? "read only" : "read write");
  }
  return { beginOptions: parts.length === 0 ? undefined : parts.join(" "), timeout };
}

function assertActive(state: TransactionState): void {
  if (!state.active) throw new DatabaseTransactionError("completed-client", "This transaction client can no longer be used after its callback has completed.");
}

function guardTransactionSql(tx: TransactionSQL, state: TransactionState): TransactionSQL {
  return new Proxy(tx, {
    apply(target, thisArg, args: unknown[]) {
      assertActive(state);
      return Reflect.apply(target as unknown as (...callArgs: unknown[]) => unknown, thisArg, args);
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "reserve") {
        return () => {
          assertActive(state);
          throw new DatabaseTransactionError("unsupported", "Opening a reserved pool connection from a transaction client is not supported.");
        };
      }
      return (...args: unknown[]) => {
        assertActive(state);
        return (value as (...callArgs: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as TransactionSQL;
}

export async function executeTransaction<Result>(
  sql: SQL,
  callback: (tx: TransactionSQL) => Result | Promise<Result>,
  options?: TransactionOptions,
): Promise<Awaited<Result>> {
  const parsed = validateOptions(options);
  const run = async (tx: TransactionSQL): Promise<Awaited<Result>> => {
    const state: TransactionState = { active: true };
    const guarded = guardTransactionSql(tx, state);
    try {
      if (parsed.timeout !== undefined) {
        await guarded.unsafe("SELECT set_config('statement_timeout', $1, true)", [`${parsed.timeout}ms`]);
      }
      return await callback(guarded);
    } finally {
      state.active = false;
    }
  };

  if (parsed.beginOptions === undefined) return await sql.begin(run) as Awaited<Result>;
  return await sql.begin(parsed.beginOptions, run) as Awaited<Result>;
}
