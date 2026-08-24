import type { PgSeed } from "@warblerjs/database";
import type { WlbPgTransactionClient } from "../generated/client";


const TOTAL = 1_000_000;
const BATCH_SIZE = 1_000;

const categories = [
  "electronics",
  "automotive",
  "clothing",
  "food",
  "tools",
  "home",
  "sports",
  "books",
  "office",
  "industrial",
];

const brands = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Omega",
  "Nova",
  "Atlas",
  "Prime",
  "Vertex",
  "Orion",
];

const statuses = [
  "active",
  "draft",
  "archived",
  "out_of_stock",
];

const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;


const randomDecimal = (
  min: number,
  max: number,
  scale = 2,
): string => {
  const value = Math.random() * (max - min) + min;

  return value.toFixed(scale);
};

const randomItem = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)]!;

export const seed: PgSeed<WlbPgTransactionClient> = async (db) => {
  for (let offset = 0; offset < TOTAL; offset += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, TOTAL - offset);

    const products = Array.from({ length: size }, (_, index) => {
      const n = offset + index + 1;

      const price = randomDecimal(5, 5_000);
      const costPrice = randomDecimal(1, Number(price));

      return {
        sku: `SKU-${n.toString().padStart(7, "0")}`,
        name: `Product ${n}`,
        category: randomItem(categories),
        brand: randomItem(brands),
        status: randomItem(statuses),

        price,
        costPrice,

        stock: randomInt(0, 2_000),
        soldQuantity: randomInt(0, 10_000),

        rating:
          Math.random() < 0.1
            ? null
            : randomDecimal(1, 5),

        weight:
          Math.random() < 0.1
            ? null
            : randomDecimal(0.1, 100, 3),

        discountPercent:
          Math.random() < 0.2
            ? null
            : randomInt(0, 70),

        isActive: Math.random() < 0.85,
        isFeatured: Math.random() < 0.1,
      };
    });

    await db.products.createMany({
      data: products,
    });

    console.log(
      `Seeded ${Math.min(offset + size, TOTAL).toLocaleString()} / ${TOTAL.toLocaleString()}`
    );
  }

  console.log("1,000,000 products seeded.");
};
