import { describe, expect, test } from "bun:test";
import { generateClientSource } from "../src/generator/generate-client";
import type { TableMetadata } from "../src/types/model.types";

const orderTable: TableMetadata = Object.freeze({
  modelName: "Order",
  clientKey: "order",
  tableName: "orders",
  columns: Object.freeze([
    Object.freeze({ fieldName: "id", columnName: "id", pgType: "uuid", sqlType: "UUID", nullable: false, unique: false, primaryKey: true, identity: false, index: false }),
    Object.freeze({ fieldName: "email", columnName: "email", pgType: "text", sqlType: "TEXT", nullable: false, unique: true, primaryKey: false, identity: false, index: false }),
    Object.freeze({ fieldName: "total", columnName: "total", pgType: "numeric", sqlType: "NUMERIC", nullable: false, unique: false, primaryKey: false, identity: false, index: false }),
    Object.freeze({ fieldName: "tax", columnName: "tax", pgType: "integer", sqlType: "INTEGER", nullable: true, unique: false, primaryKey: false, identity: false, index: false }),
    Object.freeze({ fieldName: "active", columnName: "active", pgType: "boolean", sqlType: "BOOLEAN", nullable: false, unique: false, primaryKey: false, identity: false, index: false }),
  ]),
  primaryKey: Object.freeze(["id"]),
  indexes: Object.freeze([]),
  foreignKeys: Object.freeze([]),
  checks: Object.freeze([]),
  enums: Object.freeze([]),
});

describe("generateClientSource aggregation types", () => {
  test("emits delegate APIs, trusted metadata, and type-safe aggregate field sets", () => {
    const source = generateClientSource(orderTable);

    expect(source).toContain("executeAggregate");
    expect(source).toContain("executeExists");
    expect(source).toContain("executeGroupBy");
    expect(source).toContain("count<S extends OrderCountAggregateInput>");
    expect(source).toContain("exists(args?: { readonly where?: OrderWhere }): Promise<boolean>;");
    expect(source).toContain("aggregate<A extends OrderAggregateArgs>(args: A): Promise<OrderAggregatePayload<A>>;");
    expect(source).toContain("groupBy<A extends OrderGroupByArgs>(args: A): Promise<readonly OrderGroupByPayload<A>[]>;");
    expect(source).toContain("const delegate: Record<string, unknown> = {};");
    expect(source).toContain("Object.freeze(delegate);");
    expect(source).toContain("aggregate: Object.freeze({ count: true, sum: false, avg: false, min: true, max: true })");
    expect(source).toContain("aggregate: Object.freeze({ count: true, sum: true, avg: true, min: true, max: true })");
    expect(source).toContain("export interface OrderSumAggregateInput {\n  readonly total?: boolean;\n  readonly tax?: boolean;\n}");
    expect(source).not.toContain("readonly email?: boolean;\n}\n\nexport interface OrderAvgAggregateInput");
    expect(source).toContain("readonly _sum?: OrderAggregateFilter<string | null>;");
    expect(source).toContain("readonly _min?: OrderAggregateFilter<string | null>;");
    expect(source).toContain("readonly _count?: OrderAggregateFilter<number>;");
  });
});
