import type { WlbPgClient } from "@pg/client";

declare const client: WlbPgClient;
declare const productId: number;
declare const createdAt: Date;

const existsResult = client.products.exists({
  where: {
    id: productId,
    isActive: true,
    deletedAt: null,
    createdAt: { lte: createdAt },
    price: { gte: "10.00" },
    OR: [
      { brand: "Acme" },
      { category: { contains: "tools" } },
    ],
    NOT: { status: "archived" },
  },
  withDeleted: true,
});

const booleanPromise: Promise<boolean> = existsResult;
void booleanPromise;

void client.products.exists();

// @ts-expect-error unknown fields are rejected by the model where type
void client.products.exists({ where: { unknownField: true } });

// @ts-expect-error scalar values remain model-specific
void client.products.exists({ where: { id: "not-a-number" } });

// @ts-expect-error select is not part of exists args
void client.products.exists({ select: { id: true } });

// @ts-expect-error include is not part of exists args
void client.products.exists({ include: {} });

// @ts-expect-error orderBy is not part of exists args
void client.products.exists({ orderBy: { id: "asc" } });

// @ts-expect-error cursor is not part of exists args
void client.products.exists({ cursor: { id: productId } });

// @ts-expect-error skip is not part of exists args
void client.products.exists({ skip: 1 });

// @ts-expect-error take is not part of exists args
void client.products.exists({ take: 1 });

// @ts-expect-error distinct is not part of exists args
void client.products.exists({ distinct: ["brand"] });

// @ts-expect-error lock is not part of exists args
void client.products.exists({ lock: { mode: "update" } });
