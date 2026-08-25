import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@warblerjs/compiler";
import {
  buildCommand,
  CLIError,
  createGraphGenerationPlan,
  createStarterFiles,
  createStarterProject,
  doctorCommand,
  generateGraph,
  generateSource,
  resolveInside,
  runCLI,
  validateProject,
} from "../src";
import { createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("new and generate", () => {
  test("creates the complete current starter layout", async () => {
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    const root = await createStarterProject(rootParent, "my-app");
    const required = [
      "database/warbler/pg/.gitkeep",
      "database/warbler/README.md",
      "public/.gitkeep",
      "resources/css/app.css",
      "resources/i18n/en/messages.json",
      "resources/js/app.ts",
      "resources/views/.gitkeep",
      "src/config/transports/http.config.ts",
      "src/config/crypto.config.ts",
      "src/config/database.config.ts",
      "src/config/i18n.config.ts",
      "src/config/logging.config.ts",
      "src/config/mail.config.ts",
      "src/config/profiling.config.ts",
      "src/config/runtime.config.ts",
      "src/config/view.ts",
      "src/graphs/home/home.graph.ts",
      "src/graphs/home/presentation/http/handlers/home.handlers.ts",
      "src/shared/.gitkeep",
      "src/main.ts",
      "storage/logs/.gitkeep",
      "storage/.gitignore",
      "tests/app.test.ts",
      ".env",
      ".env.example",
      ".gitignore",
      "package.json",
      "README.md",
      "tsconfig.json",
    ] as const;
    for (const path of required) {
      expect(await Bun.file(join(root, path)).exists()).toBe(true);
    }
    const tsconfig = await Bun.file(join(root, "tsconfig.json")).json() as { readonly include?: readonly string[] };
    expect(tsconfig.include).toContain(".warbler/generated/context.generated.d.ts");
    expect(tsconfig.include).toContain("resources/**/*.ts");
    expect(await Bun.file(join(root, "warbler-env.d.ts")).exists()).toBe(false);
    expect(await Bun.file(join(root, "resources/i18n/en/messages.json")).json()).toEqual({
      hello: "Hello from Warbler",
    });
    expect(await Bun.file(join(root, "resources/i18n/fr/messages.json")).exists()).toBe(false);
    expect(await Bun.file(join(root, "resources/css/components.css")).exists()).toBe(false);
    expect(await Bun.file(join(root, "src/config/view.config.ts")).exists()).toBe(false);
    const gitignore = await Bun.file(join(root, ".gitignore")).text();
    expect(gitignore).toContain(".warbler/");
    expect(gitignore).toContain(".env\n");
    expect(gitignore).toContain(".env.*\n");
    expect(gitignore).toContain("!.env.example\n");
    expect(await Bun.file(join(root, "database/warbler/README.md")).text()).toContain("database/warbler/pg/");
    const js = await Bun.file(join(root, "resources/js/app.ts")).text();
    expect(js).toContain('/// <reference lib="dom" />');
    expect(js).toContain("@warblerjs/frontend");
    expect(js).toContain("document.documentElement.dataset.warbler");
    expect(await Bun.file(join(root, "resources/css/app.css")).text()).not.toContain("tailwindcss");
    const packageJson = await Bun.file(join(root, "package.json")).json() as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };
    expect(packageJson.dependencies["@warblerjs/frontend"]).toBeDefined();
    expect(packageJson.dependencies["@warblerjs/view"]).toBeDefined();
    expect(Object.values(packageJson.dependencies).some((version) => version.includes("workspace:"))).toBe(false);
    expect(Object.values(packageJson.devDependencies).some((version) => version.includes("workspace:"))).toBe(false);
  });

  test("keeps generated environment and ignore files safe", async () => {
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    const root = await createStarterProject(rootParent, "sample-app");
    const source = await allStarterText(root);
    expect(source).not.toContain("warbler_playground");
    expect(source).not.toContain("smtp.gmail.com");
    expect(source).not.toContain("habedev");
    expect(source).not.toContain("192.168.1.100");
    const env = await Bun.file(join(root, ".env")).text();
    expect(env).toContain("APP_HOST=127.0.0.1");
    expect(env).not.toContain("APP_HOST=0.0.0.0");
    await Bun.$`git -C ${root} init --quiet`;
    const ignoredEnv = Bun.spawn(["git", "check-ignore", ".env"], { cwd: root, stdout: "ignore", stderr: "ignore" });
    expect(await ignoredEnv.exited).toBe(0);
    const ignoredExample = Bun.spawn(["git", "check-ignore", ".env.example"], { cwd: root, stdout: "ignore", stderr: "ignore" });
    expect(await ignoredExample.exited).toBe(1);
  });

  test("dry-run writes nothing and existing target directories are rejected", async () => {
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    const dryRoot = await createStarterProject(rootParent, "dry-app", true);
    expect(await Bun.file(dryRoot).exists()).toBe(false);
    const root = await createStarterProject(rootParent, "sample-app");
    expect(await Bun.file(join(root, "package.json")).exists()).toBe(true);
    await expect(createStarterProject(rootParent, "sample-app")).rejects.toThrow(CLIError);
  });

  test("starter template paths are immutable, deterministic, and root-contained", async () => {
    const parent = await Bun.$`mktemp -d`.text(); const rootParent = parent.trim();
    cleanup.push(() => rm(rootParent, { recursive: true, force: true }));
    const first = createStarterFiles({ name: "sample-app" });
    const second = createStarterFiles({ name: "sample-app" });
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.map((item) => item.path)).toEqual([...first.map((item) => item.path)].sort());
    for (const item of first) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(resolveInside(rootParent, item.path).startsWith(rootParent)).toBe(true);
      expect(item.path).not.toContain("..");
      expect(item.path.startsWith("/")).toBe(false);
    }
  });

  test("generated project passes doctor, typecheck, tests, and production build", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const layout = await validateProject(project.root);
    const diagnostics = await doctorCommand(layout);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    await runProjectCommand(project.root, ["bunx", "tsc", "--noEmit"]);
    await runProjectCommand(project.root, ["bun", "test"]);
    const result = await buildCommand(layout, { minify: true, sourcemap: true });
    expect(await Bun.file(result.entry).exists()).toBe(true);
    expect(await Bun.file(join(result.outDirectory, "public/app.css")).exists()).toBe(true);
    expect(await Bun.file(join(result.outDirectory, "public/app.js")).exists()).toBe(true);
  }, 45_000);
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

async function allStarterText(root: string): Promise<string> {
  const parts: string[] = [];
  for (const item of createStarterFiles({ name: "sample-app" })) {
    parts.push(await Bun.file(join(root, item.path)).text());
  }
  return parts.join("\n");
}

async function runProjectCommand(root: string, command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}\n${stdout}\n${stderr}`);
  }
}
