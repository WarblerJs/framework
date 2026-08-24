import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@warblerjs/compiler";
import { CLIError, createGraphGenerationPlan, createStarterProject, generateGraph, generateSource, runCLI } from "../src";
import { createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("new and generate", () => {
  test("creates the complete current starter layout", async () => {
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    const root = await createStarterProject(rootParent, "my-app");
    for (const path of ["package.json", "tsconfig.json", ".gitignore", "src/main.ts", "src/config/runtime.config.ts", "src/config/transports/http.config.ts", "src/graphs/home/home.graph.ts", "src/graphs/home/presentation/http/handlers/home.handlers.ts"]) {
      expect(await Bun.file(join(root, path)).exists()).toBe(true);
    }
    const tsconfig = await Bun.file(join(root, "tsconfig.json")).json() as { readonly include?: readonly string[] };
    expect(tsconfig.include).toContain(".warbler/generated/context.generated.d.ts");
    expect(await Bun.file(join(root, "warbler-env.d.ts")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".gitignore")).text()).toContain(".warbler/");
  });
  test("keeps legacy generate limited to a framework-backed graph file", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const plan = await generateSource(project.root, "graph", "Auth", { dryRun: true });
    expect(plan.content).toContain("@warblerjs/framework");
    expect(plan.content).toContain("defineHttpGraph");
    expect(await Bun.file(join(project.root, plan.path)).exists()).toBe(false);
    await generateSource(project.root, "graph", "Auth");
    expect(await Bun.file(join(project.root, plan.path)).exists()).toBe(true);
    await expect(generateSource(project.root, "service", "Auth")).rejects.toThrow(CLIError);
  });
  test("plans architecture-aware graph structures deterministically", () => {
    const plan = createGraphGenerationPlan({ projectRoot: "/project", name: "UserProfile", architecture: "hexagonal", transports: ["http", "socket"] });
    expect(plan.directoryName).toBe("user-profile");
    expect(plan.routePrefix).toBe("/user-profile");
    expect(plan.transports).toEqual(["http", "socket"]);
    expect(plan.files.map((file) => file.path)).toEqual([
      "src/graphs/user-profile/user-profile.http.graph.ts",
      "src/graphs/user-profile/presentation/http/handlers/user-profile.handlers.ts",
      "src/graphs/user-profile/user-profile.socket.graph.ts",
      "src/graphs/user-profile/presentation/socket/handlers/user-profile.socket.handlers.ts",
    ]);
    expect(plan.directories).toContain("src/graphs/user-profile/domain/ports");
    expect(plan.directories).toContain("src/graphs/user-profile/presentation/socket/middleware");
  });
  test("generates all graph presets and supported transport combinations", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    for (const architecture of ["minimal", "hexagonal", "clean", "mvc"] as const) {
      const result = await generateGraph({ projectRoot: project.root, name: `users-${architecture}`, architecture });
      expect(result.transports).toEqual(["http"]);
      expect(await Bun.file(join(project.root, `src/graphs/users-${architecture}/users-${architecture}.graph.ts`)).exists()).toBe(true);
    }
    const socket = await generateGraph({ projectRoot: project.root, name: "chat", transports: ["socket"] });
    expect(socket.files).toContain("src/graphs/chat/chat.graph.ts");
    const multi = await generateGraph({ projectRoot: project.root, name: "realtime", architecture: "hexagonal", transports: ["http", "socket"] });
    expect(multi.files).toContain("src/graphs/realtime/realtime.http.graph.ts");
    expect(multi.files).toContain("src/graphs/realtime/realtime.socket.graph.ts");
    const compiler = await compileProject(project.root);
    expect(compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error")).toEqual([]);
  });
  test("make:graph validates invalid input and existing graphs", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = { output: { write() {}, error() {} } };
    expect(await runCLI(["make:graph", "bad", "--architecture", "layered", "--project", project.root], capture)).toBe(2);
    expect(await runCLI(["make:graph", "bad", "--transport", "http,http", "--project", project.root], capture)).toBe(2);
    expect(await runCLI(["make:graph", "bad", "--transport", "ftp", "--project", project.root], capture)).toBe(2);
    expect(await runCLI(["make:graph", "bad", "--transport", "http,,socket", "--project", project.root], capture)).toBe(2);
    expect(await runCLI(["make:graph", "../../users", "--project", project.root], capture)).toBe(2);
    expect(await runCLI(["make:graph", "dupe", "--project", project.root], capture)).toBe(0);
    expect(await runCLI(["make:graph", "dupe", "--project", project.root], capture)).toBe(6);
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    expect(await runCLI(["make:graph", "users", "--project", rootParent], capture)).toBe(3);
  });
});
