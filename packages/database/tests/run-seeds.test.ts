import { describe, expect, test } from "bun:test";
import type { SQL, TransactionSQL } from "bun";
import { SeedError } from "../src/errors";
import { runSeeds } from "../src/seeds/run-seeds";

interface FakeSql {
  readonly sql: SQL;
  readonly ddlLog: readonly string[];
}

function createFakeSql(): FakeSql {
  const ddlLog: string[] = [];
  const tx = { unsafe: async (query: string) => { ddlLog.push(query.trim()); return []; } } as unknown as TransactionSQL;
  const sql = { begin: async (fn: (transaction: TransactionSQL) => Promise<void>) => fn(tx) } as unknown as SQL;
  return { sql, ddlLog };
}

const seedSource = (label: string) => `import type { PgSeed } from "@warbler/database";
export const seed: PgSeed = async (sql) => {
  await sql.unsafe("-- seed: ${label}");
};
`;

const createProject = async (): Promise<string> => {
  const root = `/tmp/warbler-database-seeds-${crypto.randomUUID()}`;
  await Bun.write(`${root}/seeds/20260101000000_users.ts`, seedSource("users"));
  await Bun.write(`${root}/seeds/20260102000000_posts.ts`, seedSource("posts"));
  return root;
};

describe("runSeeds", () => {
  test("runs every seed file in filename order and reports them all executed", async () => {
    const root = await createProject();
    const { sql, ddlLog } = createFakeSql();

    const result = await runSeeds(sql, { projectRoot: root, path: "seeds" });

    expect(result.executed).toEqual(["20260101000000_users", "20260102000000_posts"]);
    expect(ddlLog).toEqual(["-- seed: users", "-- seed: posts"]);
  });

  test("re-runs every seed on a second call, unlike migrations", async () => {
    const root = await createProject();
    const { sql, ddlLog } = createFakeSql();

    await runSeeds(sql, { projectRoot: root, path: "seeds" });
    const second = await runSeeds(sql, { projectRoot: root, path: "seeds" });

    expect(second.executed).toEqual(["20260101000000_users", "20260102000000_posts"]);
    expect(ddlLog).toHaveLength(4);
  });

  test("throws SeedError when a seed file has no `seed` export", async () => {
    const root = `/tmp/warbler-database-seeds-${crypto.randomUUID()}`;
    await Bun.write(`${root}/seeds/20260101000000_broken.ts`, "export const notASeed = 1;\n");
    const { sql } = createFakeSql();

    await expect(runSeeds(sql, { projectRoot: root, path: "seeds" })).rejects.toThrow(SeedError);
  });
});
