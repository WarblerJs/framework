import { describe, expect, test } from "bun:test";
import { SeedError } from "../src/errors";
import { scaffoldSeed } from "../src/seeds/scaffold-seed";

const FIXED_DATE = new Date(Date.UTC(2026, 7, 5, 14, 30, 25));

describe("scaffoldSeed", () => {
  test("produces a timestamped filename and a valid-looking seed template", () => {
    const { fileName, content } = scaffoldSeed("admin_user", FIXED_DATE);
    expect(fileName).toBe("20260805143025_admin_user.ts");
    expect(content).toContain('import type { PgSeed } from "@warbler/database"');
    expect(content).toContain("export const seed: PgSeed");
  });

  test("throws SeedError for an empty name", () => {
    expect(() => scaffoldSeed("", FIXED_DATE)).toThrow(SeedError);
  });
});
