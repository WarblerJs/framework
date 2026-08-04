import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ExitCode,
  ProcessOwner,
  buildCommand,
  doctorCommand,
  inspectCommand,
  isRelevantSourcePath,
  runCLI,
  startCommand,
  validateProject,
  type DevelopmentRuntimeLauncher,
} from "../src";
import { captureOutput, createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("top-level commands", () => {
  test("help, version, argument diagnostics, and JSON output are deterministic", async () => {
    const capture = captureOutput();
    expect(await runCLI(["--help"], { output: capture.output })).toBe(0);
    expect(capture.lines[0]).toContain("Warbler CLI");
    expect(await runCLI(["version", "--json"], { output: capture.output })).toBe(0);
    expect(JSON.parse(capture.lines[1]!).version).toBe("0.1.0");
    expect(await runCLI(["bad"], { output: capture.output })).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(capture.errors[0]).toContain("CLI1001");
  });

  test("generate and clean run through project orchestration", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = captureOutput();
    expect(await runCLI(["generate", "service", "Account", "--project", project.root], { output: capture.output })).toBe(0);
    expect(await Bun.file(join(project.root, "src/graphs/account/account.service.ts")).exists()).toBe(true);
    expect(await runCLI(["clean", "--project", project.root], { output: capture.output })).toBe(0);
    expect(await Bun.file(join(project.root, "package.json")).exists()).toBe(true);
  });
});

describe("doctor and inspect", () => {
  test("doctor validates a healthy real application without starting it", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const diagnostics = await doctorCommand(await validateProject(project.root));
    expect(diagnostics).toEqual([expect.objectContaining({ code: "CLI4000", severity: "info" })]);
  });
  test("inspect consumes compiler WIR and config", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const result = await inspectCommand(await validateProject(project.root));
    expect(result.graphs).toBe(1);
    expect(result.routes).toBe(1);
    expect(result.transports.http).toBe(true);
    expect(result.transports.websocket).toBe(false);
  });
});

describe("development", () => {
  test("compiles, writes development artifacts, and uses Runtime launcher abstraction", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let starts = 0; let stops = 0;
    let session: import("../src").DevSession | undefined;
    const launcher: DevelopmentRuntimeLauncher = {
      start(_root, compiler) {
        starts++;
        expect(compiler.generatedApplication).toBeDefined();
        return { stop() { stops++; } };
      },
    };
    const capture = captureOutput();
    const code = await runCLI(["dev", "--no-watch", "--project", project.root], {
      output: capture.output, runtimeLauncher: launcher, waitForDevSession: false,
      onDevSession(value) { session = value; },
    });
    expect(code).toBe(0);
    expect(starts).toBe(1);
    expect(await Bun.file(join(project.root, ".warbler/generated/application.generated.ts")).exists()).toBe(true);
    await session?.stop();
    expect(stops).toBe(1);
  });
  test("watch path filtering ignores generated and dependency paths", () => {
    expect(isRelevantSourcePath("src/graphs/user.ts")).toBe(true);
    expect(isRelevantSourcePath("resources/views/index.html")).toBe(true);
    expect(isRelevantSourcePath("public/app.css")).toBe(true);
    expect(isRelevantSourcePath(".warbler/generated/app.ts")).toBe(false);
    expect(isRelevantSourcePath("node_modules/pkg/index.ts")).toBe(false);
  });
});

describe("build and start", () => {
  test("bundles the real entry, public assets, and deterministic manifest", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await Bun.write(join(project.root, "public", "app.txt"), "asset");
    const layout = await validateProject(project.root);
    const result = await buildCommand(layout);
    expect(await Bun.file(result.entry).exists()).toBe(true);
    expect(await Bun.file(join(result.outDirectory, "public/app.txt")).text()).toBe("asset");
    const manifest = JSON.parse(await Bun.file(result.manifest).text());
    expect(manifest.entry).toBe("server.js");
    expect(manifest.generatedAt).toBe("deterministic");
    expect(await startCommand(layout)).toBe(0);
  }, 20_000);
  test("start never compiles a missing production build", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await expect(startCommand(await validateProject(project.root))).rejects.toMatchObject({ code: "CLI3001" });
  });
});

describe("process lifecycle", () => {
  test("forwards the exact child exit code without a shell", async () => {
    const owner = new ProcessOwner();
    owner.start(["bun", "-e", "process.exit(3)"], process.cwd());
    expect(await owner.wait()).toBe(3);
  });
});
