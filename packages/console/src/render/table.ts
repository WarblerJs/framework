import type { TableInput } from "../types";

export function renderTable(input: TableInput, unicode: boolean): readonly string[] {
  const columns = Math.max(input.headers.length, ...input.rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(
    display(input.headers[column]).length,
    ...input.rows.map((row) => display(row[column]).length),
  ));
  const edge = unicode
    ? { top: ["┌", "┬", "┐"], middle: ["├", "┼", "┤"], bottom: ["└", "┴", "┘"], vertical: "│", horizontal: "─" }
    : { top: ["+", "+", "+"], middle: ["+", "+", "+"], bottom: ["+", "+", "+"], vertical: "|", horizontal: "-" };
  const border = (parts: readonly string[]) => `${parts[0]}${widths.map((width) => edge.horizontal.repeat(width + 2)).join(parts[1])}${parts[2]}`;
  const row = (values: readonly unknown[]) => `${edge.vertical}${widths.map((width, index) => ` ${display(values[index]).padEnd(width)} `).join(edge.vertical)}${edge.vertical}`;
  return Object.freeze([
    border(edge.top),
    row(input.headers),
    border(edge.middle),
    ...input.rows.map(row),
    border(edge.bottom),
  ]);
}
function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}
