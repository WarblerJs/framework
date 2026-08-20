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
    expect(source).toContain("executeExplainFindMany");
    expect(source).toContain("PgExplainOptions");
    expect(source).toContain("PgRowLock");
    expect(source).toContain("executeExists");
    expect(source).toContain("executeGroupBy");
    expect(source).toContain("count<S extends OrderCountAggregateInput>");
    expect(source).toContain("export interface OrderCursor");
    expect(source).toContain("readonly total?: string;");
    expect(source).toContain("readonly tax?: number;");
    expect(source).toContain("readonly cursor?: OrderCursor;");
    expect(source).toContain("readonly distinct?: readonly OrderScalarField[];");
    expect(source).toContain("readonly lock?: PgRowLock;");
    expect(source).toContain("findUnique<S extends OrderSelect | undefined = undefined, I extends OrderInclude | undefined = undefined>(args: OrderFindUniqueArgs<S, I>, options?: PgExplainOptions)");
    expect(source).toContain("count<S extends OrderCountAggregateInput | undefined = undefined>(args?: OrderCountArgs<S>, options?: PgExplainOptions)");
    expect(source).toContain("export type OrderCountArgs<S extends OrderCountAggregateInput | undefined = undefined> = { readonly where?: OrderWhere; readonly select?: S; };");
    expect(source).toContain("export interface OrderExplainDelegate");
    expect(source).toContain("readonly explain: OrderExplainDelegate;");
    expect(source).toContain("delegate.explain = explain as unknown as OrderExplainDelegate;");
    expect(source).toContain("Object.freeze(explain);");
    expect(source).toContain('import { getPg } from "../runtime/pg-factory";');
    expect(source).toContain("function defaultDelegate(): OrderDelegate");
    expect(source).toContain("DEFAULT_DELEGATE ??= createOrderDelegate(getPg());");
    expect(source).toContain("export const explain = Object.freeze({");
    expect(source).toContain('primaryKeyFields: Object.freeze(["id"])');
    expect(source).toContain('field: "id", column: "id", kind: "string", pgType: "uuid"');
    expect(source).toContain('field: "total", column: "total", kind: "number", pgType: "numeric"');
    expect(source).toContain("exists(args?: { readonly where?: OrderWhere; }): Promise<boolean>;");
    expect(source).toContain("aggregate<A extends OrderAggregateArgs>(args: A & { readonly lock?: never }): Promise<OrderAggregatePayload<A>>;");
    expect(source).toContain("groupBy<A extends OrderGroupByArgs>(args: A & { readonly lock?: never }): Promise<readonly OrderGroupByPayload<A>[]>;");
    expect(source).not.toContain("readonly where?: OrderWhere; readonly select?: S; readonly lock?: PgRowLock; };");
    expect(source).not.toContain("exists(args?: { readonly where?: OrderWhere; readonly lock?: PgRowLock })");
    expect(source).not.toContain("aggregate<A extends OrderAggregateArgs & { readonly lock");
    expect(source).not.toContain("groupBy<A extends OrderGroupByArgs & { readonly lock");
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

  test("emits soft-delete metadata, scopes, and lifecycle delegates only for capable models", () => {
    const softOrder: TableMetadata = Object.freeze({
      ...orderTable,
      columns: Object.freeze([
        ...orderTable.columns,
        Object.freeze({ fieldName: "deletedAt", columnName: "deleted_at", pgType: "timestamp", sqlType: "TIMESTAMP", nullable: true, unique: false, primaryKey: false, identity: false, index: false }),
      ]),
      softDelete: Object.freeze({ enabled: true, column: "deleted_at", field: "deletedAt" }),
    });
    const source = generateClientSource(softOrder);
    expect(source).toContain("readonly deletedAt: Date | null;");
    expect(source).not.toContain("deletedAt?: Date | null;");
    expect(source).toContain('softDelete: Object.freeze({ column: "deleted_at", field: "deletedAt" })');
    expect(source).toContain("readonly withDeleted?: boolean;");
    expect(source).toContain("softDelete(args: { readonly where: OrderUniqueWhere }): Promise<OrderRow>;");
    expect(source).toContain("restoreMany(args: { readonly where: OrderWhere }): Promise<MutationCountResult>;");
    expect(source).toContain("forceDeleteMany(args: { readonly where: OrderWhere }): Promise<MutationCountResult>;");
    expect(source).toContain("delegate.softDelete =");
    expect(source).toContain('export const softDelete = (...args: readonly unknown[]) => callDefault("softDelete", args);');

    const normal = generateClientSource(orderTable);
    expect(normal).not.toContain("delegate.softDelete =");
    expect(normal).not.toContain("readonly withDeleted?: boolean;");
  });
});
