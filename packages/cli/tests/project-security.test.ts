import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CLIError, generateSource, locateProject, resolveInside, validateProject } from "../src";
import { atomicWrite, removeGeneratedDirectory } from "../src/filesystem";
import { createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("project discovery", () => {
  test("locates root from nested directories and validates layout", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const nested = join(project.root, "src", "graphs", "home");
    expect(await locateProject(nested)).toBe(project.root);
    expect((await validateProject(project.root)).main).toEndWith("src/main.ts");
  });
  test("rejects missing project structure", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await Bun.file(join(project.root, "src/main.ts")).delete();
    await expect(validateProject(project.root)).rejects.toBeInstanceOf(CLIError);
  });
});

describe("filesystem boundaries", () => {
  test("rejects traversal, absolute paths, null bytes, and unsafe names", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    expect(() => resolveInside(project.root, "../escape")).toThrow(CLIError);
    expect(() => resolveInside(project.root, "/tmp/escape")).toThrow(CLIError);
    expect(() => resolveInside(project.root, "bad\0name")).toThrow(CLIError);
    await expect(generateSource(project.root, "service", "../Escape")).rejects.toBeInstanceOf(CLIError);
  });
  test("rejects symlink output and does not overwrite without force", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await atomicWrite(project.root, "safe.txt", "one");
    await expect(atomicWrite(project.root, "safe.txt", "two")).rejects.toBeInstanceOf(CLIError);
    await atomicWrite(project.root, "safe.txt", "two", true);
    expect(await Bun.file(join(project.root, "safe.txt")).text()).toBe("two");
    await symlink(join(project.root, "safe.txt"), join(project.root, "link.txt"));
    await expect(atomicWrite(project.root, "link.txt", "bad", true)).rejects.toBeInstanceOf(CLIError);
    const outside = join(dirname(project.root), "outside");
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(project.root, "escape"));
    await expect(atomicWrite(project.root, "escape/file.txt", "bad")).rejects.toBeInstanceOf(CLIError);
  });
  test("clean targets only dist and .warbler", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await mkdir(join(project.root, "dist"), { recursive: true });
    await mkdir(join(project.root, ".warbler"), { recursive: true });
    await removeGeneratedDirectory(project.root, "dist");
    expect(await Bun.file(join(project.root, "package.json")).exists()).toBe(true);
  });
});
