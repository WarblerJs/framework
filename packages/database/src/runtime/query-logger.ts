import type { SQL, TransactionSQL } from "bun";

/** One executed query, as reported to a query logger. */
export interface QueryLogEntry {
  readonly text: string;
  readonly params: readonly unknown[];
}

export type QueryLogger = (entry: QueryLogEntry) => void;

const defaultLogger: QueryLogger = (entry) =>
  console.log(`[sql] ${entry.text}`, ...(entry.params.length === 0 ? [] : [entry.params]));

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value;
}

/** Reconstructs a `$1, $2, ...`-parameterized query string from tagged-template call arguments. */
function formatTaggedQuery(strings: TemplateStringsArray, values: readonly unknown[]): QueryLogEntry {
  let text = strings[0] ?? "";
  for (let index = 0; index < values.length; index++) text += `$${index + 1}${strings[index + 1] ?? ""}`;
  return Object.freeze({ text, params: Object.freeze(values) });
}

function wrapContextCall<T extends SQL | TransactionSQL>(target: T, value: Function, log: QueryLogger, args: unknown[]): unknown {
  const callback = args.at(-1);
  if (typeof callback !== "function") return value.apply(target, args);
  const wrapped = (tx: TransactionSQL) => callback(withQueryLogging(tx, log));
  return value.apply(target, [...args.slice(0, -1), wrapped]);
}

/** Wraps a Bun `SQL`/`TransactionSQL` instance so every executed query — tagged-template calls, `.unsafe()`, and queries run inside `.begin()` — is reported to `log` before it runs. Does not intercept `sql(value)` fragment-helper calls, which build a parameter fragment rather than executing anything. */
export function withQueryLogging<T extends SQL | TransactionSQL>(sql: T, log: QueryLogger = defaultLogger): T {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const [first, ...rest] = args;
      if (isTemplateStringsArray(first)) log(formatTaggedQuery(first, rest));
      else if (typeof first === "string") log(Object.freeze({ text: first, params: Object.freeze(rest) }));
      return Reflect.apply(target as unknown as (...callArgs: unknown[]) => unknown, thisArg, args);
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        return (query: string, params?: readonly unknown[]) => {
          log(Object.freeze({ text: query, params: Object.freeze(params ?? []) }));
          return (value as (q: string, p?: readonly unknown[]) => unknown).apply(target, [query, params]);
        };
      }
      if (prop === "begin" || prop === "transaction" || prop === "savepoint") {
        return (...args: unknown[]) => wrapContextCall(target, value, log, args);
      }
      return value.bind(target);
    },
  }) as T;
}
