import type { WlbPgClient, WlbPgTransactionClient } from "@pg/client";

declare const client: WlbPgClient;
declare const tx: WlbPgTransactionClient;
declare const productId: string;
declare const createdAt: Date;

const readonlyLock = { mode: "share", wait: "nowait" } as const;

void tx.product.findUnique({ where: { id: productId }, lock: { mode: "update" } });
void tx.product.findFirst({ where: { status: "pending" }, lock: { mode: "noKeyUpdate", wait: "wait" } });
void tx.product.findMany({ where: { status: "pending" }, lock: { mode: "share", wait: "nowait" } });
void tx.product.findMany({ where: { status: "pending" }, lock: { mode: "keyShare", wait: "skipLocked" } });
void tx.product.findUnique({ where: { id: productId }, select: { id: true, stock: true }, lock: { mode: "update" } });
void tx.product.findMany({
  cursor: { createdAt, id: productId },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  lock: { mode: "update", wait: "skipLocked" },
});
void tx.product.findFirst({ lock: readonlyLock });
void client.product.findFirst({ lock: { mode: "update" } });

// @ts-expect-error invalid lock mode
void tx.product.findFirst({ lock: { mode: "exclusive" } });

// @ts-expect-error invalid lock wait policy
void tx.product.findFirst({ lock: { mode: "update", wait: "panic" } });

// @ts-expect-error count does not accept row locks
void tx.product.count({ lock: { mode: "update" } });

// @ts-expect-error exists does not accept row locks
void tx.product.exists({ lock: { mode: "update" } });

// @ts-expect-error aggregate does not accept row locks
void tx.product.aggregate({ _count: true, lock: { mode: "update" } });

// @ts-expect-error groupBy does not accept row locks
void tx.product.groupBy({ by: ["status"], _count: true, lock: { mode: "update" } });

// @ts-expect-error mutations do not accept row locks
void tx.product.update({ where: { id: productId }, data: { stock: 1 }, lock: { mode: "update" } });
