import { describe, expect, test } from "bun:test";
import { SeedError } from "../src/errors";
import { scaffoldSeed } from "../src/seeds/scaffold-seed";

describe("scaffoldSeed", () => {
  test("starts at 0001 and produces an ORM-aware seed template", () => {
    const { fileName, content } = scaffoldSeed("admin_user", { clientImportPath: "../generated/client" });

    expect(fileName).toBe("0001_admin_user.seed.ts");
    expect(content).toContain('import type { PgSeed } from "@warbler/database"');
    expect(content).toContain('import type { WlbPgTransactionClient } from "../generated/client"');
    expect(content).toContain("export const seed: PgSeed<WlbPgTransactionClient>");
    expect(content).toContain("await db.user.createMany");
  });

  test("uses the highest valid existing prefix and ignores unrelated files", () => {
    const { fileName } = scaffoldSeed("categories", {
      existingFileNames: [
        "0001_users.seed.ts",
        "0004_products.seed.ts",
        "helpers.ts",
        "9999_not_a_seed.ts",
      ],
    });

    expect(fileName).toBe("0005_categories.seed.ts");
  });

  test("throws SeedError for unsafe names", () => {
    expect(() => scaffoldSeed("")).toThrow(SeedError);
    expect(() => scaffoldSeed("../users")).toThrow(SeedError);
    expect(() => scaffoldSeed("Users")).toThrow(SeedError);
  });
});
