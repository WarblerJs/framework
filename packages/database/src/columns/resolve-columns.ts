import { DatabaseCompileError } from "../errors";
import { deriveColumnName } from "../naming";
import type { ColumnBuilder } from "../types/column.types";
import type { NormalizedColumn } from "../types/model.types";

function isColumnBuilder(value: unknown): value is ColumnBuilder {
  return typeof value === "object" && value !== null && (value as { __wlbColumn?: unknown }).__wlbColumn === true;
}

/** Bare builder references (`id: PgTypes.Bytea`) are invoked with no arguments to obtain their base descriptor. */
function resolveColumnValue(label: string, fieldName: string, value: unknown): ColumnBuilder {
  if (typeof value === "function") {
    const resolved: unknown = (value as (options?: unknown) => unknown)();
    if (!isColumnBuilder(resolved)) {
      throw new DatabaseCompileError(label, `Field "${fieldName}" did not resolve to a PgTypes column builder.`);
    }
    return resolved;
  }
  if (isColumnBuilder(value)) return value;
  throw new DatabaseCompileError(label, `Field "${fieldName}" must be a PgTypes column builder.`);
}

/** Turns a raw `{ field: ColumnBuilder | ColumnBuilderFactory }` object (a migration's `createTable`/`addColumns` argument) into normalized columns, preserving declaration order. */
export function resolveColumns(
  label: string,
  columns: Readonly<Record<string, unknown>>,
): readonly NormalizedColumn[] {
  const fieldNames = Object.keys(columns);
  if (fieldNames.length === 0) {
    throw new DatabaseCompileError(label, "No columns were provided.");
  }
  return Object.freeze(
    fieldNames.map((fieldName) =>
      Object.freeze({
        fieldName,
        columnName: deriveColumnName(fieldName),
        builder: resolveColumnValue(label, fieldName, columns[fieldName]),
      })
    ),
  );
}
