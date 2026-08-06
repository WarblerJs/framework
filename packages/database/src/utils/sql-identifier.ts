/** Quotes a SQL identifier (table/column/constraint name), doubling any embedded quotes. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Quotes a SQL string literal, doubling any embedded quotes. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
