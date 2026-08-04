import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createStarterProject, generateSource } from "../src";
import { createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("new and generate", () => {
  test("creates the complete current starter layout", async () => {
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    const root = await createStarterProject(rootParent, "my-app");
    for (const path of ["package.json", "tsconfig.json", ".gitignore", "src/main.ts", "src/config/runtime.config.ts", "src/config/transports/http.config.ts", "src/graphs/home/home.graph.ts", "src/graphs/home/home.controller.ts"]) {
      expect(await Bun.file(join(root, path)).exists()).toBe(true);
    }
    expect(await Bun.file(join(root, ".gitignore")).text()).toContain(".warbler/");
  });
  test("generates every supported current API and supports dry-run/force", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    for (const kind of ["graph", "controller", "socket-controller", "service", "repository", "validator", "guard"] as const) {
      const plan = await generateSource(project.root, kind, "Auth", { dryRun: true });
      expect(plan.content.length).toBeGreaterThan(20);
      expect(await Bun.file(join(project.root, plan.path)).exists()).toBe(false);
      await generateSource(project.root, kind, "Auth");
      expect(await Bun.file(join(project.root, plan.path)).exists()).toBe(true);
      await generateSource(project.root, kind, "Auth", { force: true });
    }
  });
});
