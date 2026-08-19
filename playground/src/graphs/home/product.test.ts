import { WlbPg } from "@pg/client";

const PAGE_SIZE = 17;
    const TEST_LIMIT = 1000;
    
    const orderBy = [
      { price: "desc" },
      { createdAt: "asc" },
      { id: "asc" },
    ] as const;
    
    // ========================================
    // 1. Expected result بدون cursor
    // ========================================
    
    const expected = await WlbPg.product.findMany({
      where: {
        isActive: true,
      },
    
      orderBy,
    
      take: TEST_LIMIT,
    });
    
    console.log("Expected rows:", expected.length);
    
    
    // ========================================
    // 2. Traverse باستخدام cursor
    // ========================================
    
    type Product = (typeof expected)[number];

const paginated: Product[] = [];
    
    let cursor:
      | {
          price: string;
          createdAt: Date;
          id: string;
        }
      | undefined;
    
    let pageNumber = 0;
    
    while (paginated.length < TEST_LIMIT) {
      pageNumber++;
    
      if (pageNumber > 10_000) {
        throw new Error("Cursor traversal appears to be stuck");
      }
    
      const remaining = TEST_LIMIT - paginated.length;
      const take = Math.min(PAGE_SIZE, remaining);
    
      const page = await WlbPg.product.findMany({
        where: {
          isActive: true,
        },
    
        orderBy,
    
        ...(cursor
          ? {
              cursor,
            }
          : {}),
    
        take,
      });
    
      if (page.length === 0) {
        break;
      }
    
      paginated.push(...page);
    
      const last = page.at(-1)!;
    
      const nextCursor = {
        price: last.price,
        createdAt: last.createdAt,
        id: last.id,
      };
    
      // حماية من infinite loop
      if (
        cursor &&
        cursor.price === nextCursor.price &&
        cursor.createdAt.getTime() === nextCursor.createdAt.getTime() &&
        cursor.id === nextCursor.id
      ) {
        throw new Error(
          `Cursor did not advance at page ${pageNumber}`
        );
      }
    
      cursor = nextCursor;
    }
    
    
    // ========================================
    // 3. Compare
    // ========================================
    
    const expectedIds = expected.map((product) => product.id);
    const paginatedIds = paginated.map((product) => product.id);
    
    console.log("Expected:", expectedIds.length);
    console.log("Paginated:", paginatedIds.length);
    console.log("Pages:", pageNumber);
    
    
    // ========================================
    // 4. Check duplicates
    // ========================================
    
    const uniqueIds = new Set(paginatedIds);
    
    if (uniqueIds.size !== paginatedIds.length) {
      const seen = new Set<string>();
      const duplicates: string[] = [];
    
      for (const id of paginatedIds) {
        if (seen.has(id)) {
          duplicates.push(id);
        }
    
        seen.add(id);
      }
    
      console.error("❌ DUPLICATES FOUND");
      console.table(duplicates);
    
      throw new Error(
        `Found ${paginatedIds.length - uniqueIds.size} duplicate rows`
      );
    }
    
    console.log("✅ No duplicates");
    
    
    // ========================================
    // 5. Check missing / wrong order
    // ========================================
    
    if (expectedIds.length !== paginatedIds.length) {
      throw new Error(
        `Length mismatch: expected=${expectedIds.length}, paginated=${paginatedIds.length}`
      );
    }
    
    for (let i = 0; i < expectedIds.length; i++) {
      if (expectedIds[i] !== paginatedIds[i]) {
        console.error("❌ MISMATCH AT INDEX:", i);
    
        console.log({
          expected: expectedIds[i],
          received: paginatedIds[i],
        });
    
        throw new Error(`Cursor traversal mismatch at index ${i}`);
      }
    }
    
    console.log("✅ No missing rows");
    console.log("✅ Exact ordering");
    console.log("✅ Cursor always advanced");
    
    console.log(
      `🚀 FULL TRAVERSAL PASSED — ${paginated.length} rows across ${pageNumber} pages`
    );