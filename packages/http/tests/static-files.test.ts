import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStaticRouteTable, resolveStaticPath } from "../src/static";

let temporary: string | undefined;

afterEach(async () => {
  if (temporary !== undefined) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("static files", () => {
  test("builds Bun.file routes once and provides HEAD responses", async () => {
    temporary = await mkdtemp(join(tmpdir(), "warbler-http-"));
    await mkdir(join(temporary, "public"));
    await Bun.write(join(temporary, "public", "app.css"), "body{}");
    await Bun.write(join(temporary, "public", "index.html"), "home");
    const table = await createStaticRouteTable(temporary, {
      enabled: true, root: "public", prefix: "/", indexFiles: ["index.html"],
      exposeDotfiles: false, exposeSourceMaps: false,
      cacheControl: { enabled: true, immutableAssets: true },
    });
    const route = table["/app.css"];
    expect(route).toBeDefined();
    expect(route).toHaveProperty("GET");
    expect(route).toHaveProperty("HEAD");
    expect(table["/"]).toHaveProperty("GET");
  });

  test("rejects encoded traversal and symlink escape", async () => {
    temporary = await mkdtemp(join(tmpdir(), "warbler-http-"));
    const root = join(temporary, "public");
    await mkdir(root);
    await Bun.write(join(temporary, "private.txt"), "secret");
    await symlink(join(temporary, "private.txt"), join(root, "escape.txt"));
    expect(resolveStaticPath(root, "%252e%252e/private.txt")).rejects.toThrow();
    expect(resolveStaticPath(root, "escape.txt")).rejects.toThrow("escapes");
  });
});
