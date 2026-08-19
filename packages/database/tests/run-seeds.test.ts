import { describe, expect, test } from "bun:test";
import type { SQL, TransactionSQL } from "bun";
import { SeedError } from "../src/errors";
import { DEFAULT_SEED_TABLE, ensureSeedsTable, runSeeds } from "../src/seeds/run-seeds";

interface FakeSql {
  readonly sql: SQL;
  readonly appLog: readonly string[];
  readonly ddlLog: readonly string[];
  readonly tracked: readonly { readonly name: string; readonly batch: number }[];
  readonly transactionCount: number;
}

function createFakeSql(options: { readonly failTrackingFor?: string } = {}): FakeSql {
  const appLog: string[] = [];
  const ddlLog: string[] = [];
  let tracked: { name: string; batch: number }[] = [];
  let transactionCount = 0;

  const unsafe = async (query: string, params?: readonly unknown[]) => {
    const trimmed = query.trim();
    if (trimmed.startsWith("CREATE TABLE IF NOT EXISTS")) {
      ddlLog.push(trimmed);
      return [];
    }
    if (trimmed.startsWith("SELECT name FROM")) return tracked.map((row) => ({ name: row.name }));
    if (trimmed.startsWith("SELECT max(batch) AS max")) {
      return [{ max: tracked.reduce<number | null>((max, row) => max === null || row.batch > max ? row.batch : max, null) }];
    }
    if (trimmed.startsWith("INSERT INTO") && trimmed.includes("(name, batch)")) {
      const name = String(params?.[0]);
      if (name === options.failTrackingFor) throw new Error("tracking insert failed");
      if (tracked.some((row) => row.name === name)) throw new Error("duplicate seed");
      tracked.push({ name, batch: Number(params?.[1]) });
      return [];
    }
    appLog.push(trimmed);
    if (trimmed === "-- fail") throw new Error("seed failed");
    return [];
  };

  const sql = {
    unsafe,
    begin: async (callback: (transaction: TransactionSQL) => Promise<void>) => {
      transactionCount++;
      const appSnapshot = [...appLog];
      const trackedSnapshot = [...tracked];
      try {
        await callback({ unsafe } as unknown as TransactionSQL);
      } catch (cause) {
        appLog.length = 0;
        appLog.push(...appSnapshot);
        tracked = trackedSnapshot;
        throw cause;
      }
    },
  } as unknown as SQL;

  return {
    sql,
    appLog,
    ddlLog,
    get tracked() { return tracked; },
    get transactionCount() { return transactionCount; },
  };
}

const seedSource = (body: string) => `import type { PgSeed } from "@warbler/database";
export const seed: PgSeed<{ readonly unsafe: (query: string) => Promise<unknown> }> = async (db) => {
  ${body}
};
`;

async function writeSeed(root: string, fileName: string, body: string): Promise<void> {
  await Bun.write(`${root}/seeds/${fileName}`, seedSource(body));
}

async function createProject(): Promise<string> {
  const root = `/tmp/warbler-database-seeds-${crypto.randomUUID()}`;
  await writeSeed(root, "0001_users.seed.ts", 'await db.unsafe("-- seed: users");');
  await writeSeed(root, "0002_products.seed.ts", 'await db.unsafe("-- seed: products");');
  await Bun.write(`${root}/seeds/helpers.ts`, 'throw new Error("helpers must not run");\n');
  await Bun.write(`${root}/seeds/data.ts`, 'throw new Error("data must not run");\n');
  return root;
}

describe("runSeeds", () => {
  test("ensures the configured tracking table and runs pending seeds once in filename order", async () => {
    const root = await createProject();
    const fake = createFakeSql();

    const first = await runSeeds(fake.sql, { projectRoot: root, path: "seeds", table: "custom_seeds", createClient: (tx) => tx });
    const second = await runSeeds(fake.sql, { projectRoot: root, path: "seeds", table: "custom_seeds", createClient: (tx) => tx });

    expect(first.executed).toEqual([{ name: "0001_users.seed.ts", batch: 1 }, { name: "0002_products.seed.ts", batch: 1 }]);
    expect(second.executed).toEqual([]);
    expect(second.skipped).toEqual(["0001_users.seed.ts", "0002_products.seed.ts"]);
    expect(fake.appLog).toEqual(["-- seed: users", "-- seed: products"]);
    expect(fake.tracked).toEqual([{ name: "0001_users.seed.ts", batch: 1 }, { name: "0002_products.seed.ts", batch: 1 }]);
    expect(fake.ddlLog[0]).toContain('CREATE TABLE IF NOT EXISTS "custom_seeds"');
  });

  test("runs newly-added seeds later with the next batch number", async () => {
    const root = await createProject();
    const fake = createFakeSql();

    await runSeeds(fake.sql, { projectRoot: root, path: "seeds", createClient: (tx) => tx });
    await writeSeed(root, "0003_categories.seed.ts", 'await db.unsafe("-- seed: categories");');
    await writeSeed(root, "0004_roles.seed.ts", 'await db.unsafe("-- seed: roles");');
    const later = await runSeeds(fake.sql, { projectRoot: root, path: "seeds", createClient: (tx) => tx });

    expect(later.executed).toEqual([{ name: "0003_categories.seed.ts", batch: 2 }, { name: "0004_roles.seed.ts", batch: 2 }]);
    expect(fake.tracked.map((row) => `${row.name}:${row.batch}`)).toEqual([
      "0001_users.seed.ts:1",
      "0002_products.seed.ts:1",
      "0003_categories.seed.ts:2",
      "0004_roles.seed.ts:2",
    ]);
  });

  test("resolves --only exactly, reports already executed seeds, and rejects missing or ambiguous names", async () => {
    const root = await createProject();
    const fake = createFakeSql();

    const only = await runSeeds(fake.sql, { projectRoot: root, path: "seeds", only: "users", createClient: (tx) => tx });
    const already = await runSeeds(fake.sql, { projectRoot: root, path: "seeds", only: "users", createClient: (tx) => tx });
    await writeSeed(root, "0003_admin_users.seed.ts", 'await db.unsafe("-- seed: admin_users");');
    await writeSeed(root, "0004_users.seed.ts", 'await db.unsafe("-- seed: users again");');

    expect(only.executed).toEqual([{ name: "0001_users.seed.ts", batch: 1 }]);
    expect(already.alreadyExecuted).toBe("0001_users.seed.ts");
    expect(already.executed).toEqual([]);
    await expect(runSeeds(fake.sql, { projectRoot: root, path: "seeds", only: "payments", createClient: (tx) => tx })).rejects.toThrow(SeedError);
    await expect(runSeeds(fake.sql, { projectRoot: root, path: "seeds", only: "users", createClient: (tx) => tx })).rejects.toThrow(SeedError);
  });

  test("does not execute seed data when confirmation is rejected", async () => {
    const root = await createProject();
    const fake = createFakeSql();

    const result = await runSeeds(fake.sql, { projectRoot: root, path: "seeds", createClient: (tx) => tx, confirm: () => false });

    expect(result.canceled).toBe(true);
    expect(result.pending).toEqual(["0001_users.seed.ts", "0002_products.seed.ts"]);
    expect(fake.appLog).toEqual([]);
    expect(fake.tracked).toEqual([]);
    expect(fake.transactionCount).toBe(0);
  });

  test("rolls back seed mutations and tracking when a seed fails, and stops later seeds", async () => {
    const root = `/tmp/warbler-database-seeds-${crypto.randomUUID()}`;
    await writeSeed(root, "0001_users.seed.ts", 'await db.unsafe("-- seed: users");');
    await writeSeed(root, "0002_products.seed.ts", 'await db.unsafe("-- seed: products A"); await db.unsafe("-- fail");');
    await writeSeed(root, "0003_prices.seed.ts", 'await db.unsafe("-- seed: prices");');
    const fake = createFakeSql();

    await expect(runSeeds(fake.sql, { projectRoot: root, path: "seeds", createClient: (tx) => tx })).rejects.toThrow("seed failed");

    expect(fake.appLog).toEqual(["-- seed: users"]);
    expect(fake.tracked).toEqual([{ name: "0001_users.seed.ts", batch: 1 }]);
  });

  test("rolls back seed mutations when tracking insert fails", async () => {
    const root = await createProject();
    const fake = createFakeSql({ failTrackingFor: "0001_users.seed.ts" });

    await expect(runSeeds(fake.sql, { projectRoot: root, path: "seeds", createClient: (tx) => tx })).rejects.toThrow("tracking insert failed");

    expect(fake.appLog).toEqual([]);
    expect(fake.tracked).toEqual([]);
  });

  test("throws SeedError when a seed file has no named seed export or invalid metadata", async () => {
    const brokenRoot = `/tmp/warbler-database-seeds-${crypto.randomUUID()}`;
    await Bun.write(`${brokenRoot}/seeds/0001_broken.seed.ts`, "export default async function seed() {}\n");
    await expect(runSeeds(createFakeSql().sql, { projectRoot: brokenRoot, path: "seeds", createClient: (tx) => tx })).rejects.toThrow(SeedError);

    const invalidRoot = `/tmp/warbler-database-seeds-${crypto.randomUUID()}`;
    await Bun.write(`${invalidRoot}/seeds/users.seed.ts`, "export const seed = () => undefined;\n");
    await expect(runSeeds(createFakeSql().sql, { projectRoot: invalidRoot, path: "seeds", createClient: (tx) => tx })).rejects.toThrow(SeedError);
    await expect(ensureSeedsTable(createFakeSql().sql, 'bad"name')).rejects.toThrow(SeedError);
  });

  test("uses the default seed table name", async () => {
    const root = await createProject();
    const fake = createFakeSql();

    await runSeeds(fake.sql, { projectRoot: root, path: "seeds", createClient: (tx) => tx });

    expect(DEFAULT_SEED_TABLE).toBe("_warbler_seeds");
    expect(fake.ddlLog[0]).toContain('CREATE TABLE IF NOT EXISTS "_warbler_seeds"');
  });
});
