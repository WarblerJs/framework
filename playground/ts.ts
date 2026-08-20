import { WlbPg } from "./database/warbler/pg/generated/client";


// const rows = await WlbPg.products.findMany({
//     where: {
//       isActive: true,
//     },
//     orderBy: {
//       id: "asc",
//     },
//     take: 50,
//   });
  
//   await WlbPg.products.softDeleteMany({
//     where: {
//       id: {
//         in: rows.map((row) => row.id),
//       },
//     },
//   });

const PAGE_SIZE = 17;
const TEST_LIMIT = 200;

const orderBy = [
  { price: "desc" },
  { createdAt: "asc" },
  { id: "asc" },
] as const;

const expected = await WlbPg.products.findMany({
  onlyDeleted: true,
  orderBy,
  take: TEST_LIMIT,
});

type Product = (typeof expected)[number];

const paginated: Product[] = [];

let cursor:
  | {
      price: string;
      createdAt: Date;
      id: number;
    }
  | undefined;

let pageNumber = 0;

while (paginated.length < TEST_LIMIT) {
  pageNumber++;

  if (pageNumber > 10_000) {
    throw new Error("Cursor traversal appears stuck");
  }

  const remaining = TEST_LIMIT - paginated.length;

  const page = await WlbPg.products.findMany({
    onlyDeleted: true,
    orderBy,

    ...(cursor ? { cursor } : {}),

    take: Math.min(PAGE_SIZE, remaining),
  });

  if (page.length === 0) {
    break;
  }

  for (const row of page) {
    if (row.deletedAt === null) {
      throw new Error(
        `Active row leaked into onlyDeleted traversal: ${row.id}`,
      );
    }
  }

  paginated.push(...page);

  const last = page.at(-1)!;

  const nextCursor = {
    price: last.price,
    createdAt: last.createdAt,
    id: last.id,
  };

  if (
    cursor &&
    cursor.price === nextCursor.price &&
    cursor.createdAt.getTime() === nextCursor.createdAt.getTime() &&
    cursor.id === nextCursor.id
  ) {
    throw new Error(`Cursor did not advance at page ${pageNumber}`);
  }

  cursor = nextCursor;
}

const expectedIds = expected.map((row) => row.id);
const paginatedIds = paginated.map((row) => row.id);

console.log("Expected deleted:", expectedIds.length);
console.log("Paginated deleted:", paginatedIds.length);
console.log("Pages:", pageNumber);

const uniqueIds = new Set(paginatedIds);

if (uniqueIds.size !== paginatedIds.length) {
  throw new Error("Duplicate rows found");
}

console.log("✅ No duplicates");

if (expectedIds.length !== paginatedIds.length) {
  throw new Error(
    `Length mismatch: expected=${expectedIds.length}, paginated=${paginatedIds.length}`,
  );
}

for (let i = 0; i < expectedIds.length; i++) {
  if (expectedIds[i] !== paginatedIds[i]) {
    throw new Error(`Ordering mismatch at index ${i}`);
  }
}

console.log("✅ No missing deleted rows");
console.log("✅ Exact ordering");
console.log("✅ No active rows leaked");
console.log("✅ Cursor always advanced");