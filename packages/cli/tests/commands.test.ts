import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import {
  ExitCode,
  ProcessOwner,
  buildCommand,
  devCommand,
  doctorCommand,
  inspectCommand,
  isRelevantSourcePath,
  runCLI,
  startCommand,
  validateProject,
  type DevelopmentRuntimeLauncher,
} from "../src";
import { compileProject } from "@warbler/compiler";
import { GeneratedBindingsRuntimeLauncher, loadTransportLaunchers } from "../src/dev/runtime-launcher";
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
        expect(capture.lines.join("\n")).not.toContain("Runtime is running");
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
    expect(capture.lines.join("\n")).toContain("Runtime is running");
    expect(capture.lines.join("\n")).toContain("Executable bindings generated");
    expect(capture.lines.join("\n")).toContain("Filesystem watcher disabled");
    expect(await Bun.file(join(project.root, ".warbler/generated/application.generated.ts")).exists()).toBe(true);
    await session?.stop();
    expect(stops).toBe(1);
  });
  test("dev JSON progress is structured and contains no ANSI escapes", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let session: import("../src").DevSession | undefined;
    const capture = captureOutput();
    const code = await runCLI(["dev", "--json", "--verbose", "--no-watch", "--project", project.root], {
      output: capture.output,
      runtimeLauncher: { start() { return { stop() {} }; } },
      waitForDevSession: false,
      onDevSession(value) { session = value; },
    });
    expect(code).toBe(0);
    expect(capture.lines.every((line) => {
      JSON.parse(line);
      return !line.includes("\u001b");
    })).toBe(true);
    expect(capture.lines.some((line) => line.includes('"stage":"compiler"'))).toBe(true);
    await session?.stop();
  });
  test("watch path filtering ignores generated and dependency paths", () => {
    expect(isRelevantSourcePath("src/graphs/user.ts")).toBe(true);
    expect(isRelevantSourcePath("resources/views/index.html")).toBe(true);
    expect(isRelevantSourcePath("public/app.css")).toBe(false);
    expect(isRelevantSourcePath("design-system/sources/components.html")).toBe(true);
    expect(isRelevantSourcePath(".warbler/generated/app.ts")).toBe(false);
    expect(isRelevantSourcePath("node_modules/pkg/index.ts")).toBe(false);
  });
  test("loads Compiler-generated bindings into the real Runtime and lazily resolves enabled launchers", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const priorSecret = process.env.WARBLER_CSRF_SECRET;
    process.env.WARBLER_CSRF_SECRET = "abcdefghijklmnopqrstuvwxyz123456";
    const runtimePath = join(project.root, "src/config/runtime.config.ts");
    const source = await Bun.file(runtimePath).text();
    await Bun.write(runtimePath, source.replace("http: { enabled: true, port: 3000 }", "http: { enabled: false, port: 3000 }"));
    try {
      const compiler = await compileProject(project.root);
      const handle = await new GeneratedBindingsRuntimeLauncher().start(project.root, compiler);
      await handle.stop();
      expect(await loadTransportLaunchers([], project.root)).toEqual([]);
      expect((await loadTransportLaunchers(["websocket"], project.root))[0]?.kind).toBe("websocket");
    } finally {
      restoreEnv("WARBLER_CSRF_SECRET", priorSecret);
    }
  });
  test("discovers declarative graph globs and executes the acceptance fixture through real HTTP", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const port = 39_200 + Math.floor(Math.random() * 500);
    const wsPort = port + 1;
    await Bun.write(join(project.root, "src/main.ts"), `import { createApp, Transport } from "@warbler/core";

export default createApp({
  transports: [
    Transport.HTTP,
    Transport.WEBSOCKET,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
`);
    await Bun.write(join(project.root, "src/config/runtime.config.ts"), `export default {
  network: { host: "127.0.0.1" },
  transports: {
    http: { enabled: true, port: ${port} },
    websocket: { enabled: false, mode: "standalone", port: ${wsPort} },
    tcp: { enabled: false }, udp: { enabled: false }, mcp: { enabled: false }, webrtc: { enabled: false },
  },
  telemetry: {
    metrics: { enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" },
    healthCheck: { enabled: false, host: "127.0.0.1", port: 9091, path: "/health" },
  },
} as const;
`);
    await Bun.write(join(project.root, "src/config/transports/ws.config.ts"), `export const wsConfig = {
  security: { origins: { required: false, allowed: [] }, authentication: { required: false }, protocols: { allowed: [], required: false } },
  messages: { format: "json", maxPayloadLength: "1mb", maxEventNameLength: 128, maxMessageIdLength: 128, unknownEvent: "send-error" },
  compression: { enabled: false, threshold: "4kb" },
  timeouts: { idle: "60s", handler: "30s" },
  backpressure: { limit: "1mb", closeOnLimit: true, strategy: "reject-new" },
  limits: { totalConnections: 100, connectionsPerIp: 20, subscriptionsPerConnection: 10, eventsPerSecond: 50 },
  bun: { sendPings: true, publishToSelf: false },
} as const;
`);
    await Bun.write(join(project.root, "src/config/transports/http.config.ts"), `export const httpConfig = {
  request: { body: { unknownContentType: "reject" }, headers: {}, query: {}, cookies: {}, path: {}, timeouts: { idle: 10_000 } },
  csrf: { enabled: false, methods: ["POST"], headerName: "x-csrf-token", cookieName: "__Host-warbler-csrf", fieldName: "_csrf", sources: ["header"], strictSources: true },
  rateLimit: { onExceeded: "reject", statusCode: 429 },
} as const;
`);
    await Bun.write(join(project.root, "src/graphs/test/test.validator.ts"), `import { defineValidator, v } from "@warbler/validators";
export const testValidator = defineValidator({
  csrf: true,
  bodyRules: { message: v.string("validators.invalidMessage").min(1, "validators.invalidMessage") },
});
`);
    await Bun.write(join(project.root, "src/graphs/test/test.handlers.ts"), `import { defineHandler, Service } from "@warbler/core";
import { JsonRes, type AppRequest } from "@warbler/http";
import { testValidator } from "./test.validator";
@Service()
export class CounterUseCase {
  static constructed = 0;
  readonly instance = ++CounterUseCase.constructed;
  execute() { return this.instance; }
}
export const getTest = defineHandler({
  run: (ctx: AppRequest) => JsonRes({ success: true, method: "GET" }),
});
export const getCount = defineHandler({
  useCase: { counter: CounterUseCase },
  run: (ctx: AppRequest, { counter }) => JsonRes({ count: counter.execute() }),
});
export const postTest = defineHandler({
  validator: testValidator,
  guards: [],
  middlewares: [],
  run: (ctx: AppRequest) => JsonRes({ success: true, method: "POST", body: ctx.body }),
});
`);
    await Bun.write(join(project.root, "src/graphs/test/test.graph.ts"), `import { defineHttpGraph } from "@warbler/http";
import * as handlers from "./test.handlers";
export default defineHttpGraph({
  prefix: "/api",
  middlewares: [],
  providers: [],
  routes: {
    "GET /test": handlers.getTest,
    "GET /count": handlers.getCount,
    "POST /test": { handler: handlers.postTest, name: "test.create" },
  },
});
`);
    const priorSecret = process.env.WARBLER_CSRF_SECRET;
    process.env.WARBLER_CSRF_SECRET = "abcdefghijklmnopqrstuvwxyz123456";
    const compiler = await compileProject(project.root);
    expect(compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error")).toEqual([]);
    expect(compiler.applicationWIR?.transports).toEqual(["http", "websocket"]);
    const handle = await new GeneratedBindingsRuntimeLauncher().start(project.root, compiler);
    cleanup.push(async () => { await handle.stop(); });
    try {
      const get = await fetch(`http://127.0.0.1:${port}/api/test`);
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual({ success: true, method: "GET" });
      const countOne = await fetch(`http://127.0.0.1:${port}/api/count`);
      const countTwo = await fetch(`http://127.0.0.1:${port}/api/count`);
      expect(countOne.status).toBe(200);
      expect(countTwo.status).toBe(200);
      expect(await countOne.json()).toEqual({ count: 1 });
      expect(await countTwo.json()).toEqual({ count: 1 });
      const rejected = await fetch(`http://127.0.0.1:${port}/api/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(rejected.status).toBe(403);
      const token = signCsrfToken("acceptance-token", "abcdefghijklmnopqrstuvwxyz123456");
      const accepted = await fetch(`http://127.0.0.1:${port}/api/test`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ success: true, method: "POST", body: { message: "hello" } });
      const invalid = await fetch(`http://127.0.0.1:${port}/api/test`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ message: "" }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      restoreEnv("WARBLER_CSRF_SECRET", priorSecret);
      await handle.stop();
    }
    const build = await buildCommand(await validateProject(project.root));
    const child = Bun.spawn(["bun", build.entry], {
      cwd: project.root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WARBLER_CSRF_SECRET: "abcdefghijklmnopqrstuvwxyz123456" },
    });
    cleanup.push(async () => {
      if (child.exitCode === null) child.kill("SIGTERM");
      await child.exited;
    });
    let productionGet: Response | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        productionGet = await fetch(`http://127.0.0.1:${port}/api/test`);
        if (productionGet.status === 200) break;
      } catch {}
      await Bun.sleep(50);
    }
    expect(productionGet?.status).toBe(200);
    expect(await productionGet!.json()).toEqual({ success: true, method: "GET" });
    child.kill("SIGTERM");
    await child.exited;
  }, 45_000);

  test("hot reload rebuilds declarative graph, handler, and validator changes without retaining runtimes", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await Bun.write(join(project.root, "src/main.ts"), `import { createApp, Transport } from "@warbler/core";

export default createApp({
  transports: [
    Transport.HTTP,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
`);
    await Bun.write(join(project.root, "src/graphs/test/test.validator.ts"), `import { defineValidator, v } from "@warbler/validators";
export const testValidator = defineValidator({
  csrf: true,
  bodyRules: { message: v.string("validators.invalidMessage").min(1, "validators.invalidMessage") },
});
`);
    await Bun.write(join(project.root, "src/graphs/test/test.handlers.ts"), `import { defineHandler } from "@warbler/core";
import { JsonRes, type AppRequest } from "@warbler/http";
import { testValidator } from "./test.validator";
export const getTest = defineHandler({
  run: (_ctx: AppRequest) => JsonRes({ version: 1 }),
});
export const postTest = defineHandler({
  validator: testValidator,
  run: (ctx: AppRequest) => JsonRes({ body: ctx.body }),
});
`);
    const graphPath = join(project.root, "src/graphs/test/test.graph.ts");
    await Bun.write(graphPath, `import { defineHttpGraph } from "@warbler/http";
import * as handlers from "./test.handlers";
export default defineHttpGraph({
  prefix: "/api",
  routes: {
    "GET /test": handlers.getTest,
    "POST /test": handlers.postTest,
  },
});
`);
    const snapshots: Array<Readonly<{ fingerprint: string | undefined; routePaths: readonly string[]; csrf: readonly boolean[] }>> = [];
    let stops = 0;
    const session = await devCommand(project.root, {
      start(_root, compiler) {
        snapshots.push(Object.freeze({
          fingerprint: compiler.fingerprint,
          routePaths: Object.freeze(compiler.applicationWIR?.graphs.flatMap((graph) => graph.controllers.flatMap((controller) => controller.routes.map((route) => `${graph.prefix}${route.path}`))) ?? []),
          csrf: Object.freeze(compiler.applicationWIR?.graphs.flatMap((graph) => graph.controllers.flatMap((controller) => controller.routes.map((route) => route.csrf))) ?? []),
        }));
        return { stop() { stops++; } };
      },
    }, false);
    cleanup.push(() => session.stop());

    await Bun.write(graphPath, `import { defineHttpGraph } from "@warbler/http";
import * as handlers from "./test.handlers";
export default defineHttpGraph({
  prefix: "/api",
  routes: {
    "GET /test": handlers.getTest,
    "GET /changed": handlers.getTest,
    "POST /test": handlers.postTest,
  },
});
`);
    await (session as unknown as { notifyChanges(paths: readonly string[]): Promise<void> }).notifyChanges(["src/graphs/test/test.graph.ts"]);
    expect(snapshots.at(-1)?.routePaths).toContain("/api/changed");

    await Bun.write(join(project.root, "src/graphs/test/test.handlers.ts"), `import { defineHandler } from "@warbler/core";
import { JsonRes, type AppRequest } from "@warbler/http";
import { testValidator } from "./test.validator";
export const getTest = defineHandler({
  run: (_ctx: AppRequest) => JsonRes({ version: 2 }),
});
export const postTest = defineHandler({
  validator: testValidator,
  run: (ctx: AppRequest) => JsonRes({ body: ctx.body }),
});
`);
    await (session as unknown as { notifyChanges(paths: readonly string[]): Promise<void> }).notifyChanges(["src/graphs/test/test.handlers.ts"]);
    expect(new Set(snapshots.map((snapshot) => snapshot.fingerprint)).size).toBeGreaterThanOrEqual(3);

    await Bun.write(join(project.root, "src/graphs/test/test.validator.ts"), `import { defineValidator, v } from "@warbler/validators";
export const testValidator = defineValidator({
  csrf: false,
  bodyRules: { message: v.string("validators.invalidMessage").min(1, "validators.invalidMessage") },
});
`);
    await (session as unknown as { notifyChanges(paths: readonly string[]): Promise<void> }).notifyChanges(["src/graphs/test/test.validator.ts"]);
    expect(snapshots.at(-1)?.csrf).not.toContain(true);

    expect(snapshots).toHaveLength(4);
    expect(stops).toBe(3);
    await session.stop();
  }, 30_000);
});

function signCsrfToken(token: string, secret: string): string {
  const signature = createHmac("sha256", new TextEncoder().encode(secret)).update(token).digest();
  return `${token}.${new Uint8Array(signature).toBase64({ alphabet: "base64url", omitPadding: true })}`;
}
function restoreEnv(key: string, prior: string | undefined): void {
  if (prior === undefined) delete process.env[key];
  else process.env[key] = prior;
}

describe("build and start", () => {
  test("bundles the real entry, public assets, and deterministic manifest", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const runtimePath = join(project.root, "src/config/runtime.config.ts");
    const runtimeSource = await Bun.file(runtimePath).text();
    const port = 38_000 + Math.floor(Math.random() * 1_000);
    await Bun.write(runtimePath, runtimeSource.replace("port: 3000", `port: ${port}`));
    await Bun.write(join(project.root, "public", "app.txt"), "asset");
    const layout = await validateProject(project.root);
    const result = await buildCommand(layout);
    expect(await Bun.file(result.entry).exists()).toBe(true);
    expect(await Bun.file(join(result.outDirectory, "public/app.txt")).text()).toBe("asset");
    const manifest = JSON.parse(await Bun.file(result.manifest).text());
    expect(manifest.entry).toBe("server.js");
    expect(manifest.generatedAt).toBe("deterministic");
    expect(manifest.applicationFingerprint).toBeTypeOf("string");
    const productionEntry = await Bun.file(join(project.root, ".warbler/generated/production-entry.ts")).text();
    expect(productionEntry).toContain("createHttpRuntimeLauncher");
    expect(productionEntry).not.toContain("createWebSocketRuntimeLauncher");
    const bundle = await Bun.file(result.entry).text();
    expect(bundle).not.toContain("@warbler/compiler");
    expect(bundle).not.toContain("@warbler/cli");
    const child = Bun.spawn(["bun", result.entry], { cwd: project.root, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(150);
    expect(child.exitCode).toBeNull();
    child.kill("SIGTERM");
    await child.exited;
  }, 20_000);
  test("start never compiles a missing production build", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await expect(startCommand(await validateProject(project.root))).rejects.toMatchObject({ code: "CLI2011" });
  });
});

describe("database", () => {
  const writeDatabaseConfig = (root: string) =>
    Bun.write(
      join(root, "src/config/database.config.ts"),
      `export const databaseConfig = {
  pg: {
    connection: {},
    migrations: {
      table: "_wrbls_migrations",
      seedTable: "_warbler_seeds",
      generated: "database/warbler/pg/generated",
      path: "database/warbler/pg/migrations",
      seeds: "database/warbler/pg/seeds",
      softDelete: true,
    },
  },
};
`,
    );

  const writeDatabaseConfigWithoutSoftDelete = (root: string) =>
    Bun.write(
      join(root, "src/config/database.config.ts"),
      `export const databaseConfig = {
  pg: {
    connection: {},
    migrations: {
      table: "_wrbls_migrations",
      seedTable: "_warbler_seeds",
      generated: "database/warbler/pg/generated",
      path: "database/warbler/pg/migrations",
      seeds: "database/warbler/pg/seeds",
      softDelete: false,
    },
  },
};
`,
    );

  // Note: `db:pg generate`, `db:pg migration` (run), `db:pg rollback`, and `db:pg seed:run` all require
  // a reachable Postgres connection, which is not available in this environment — only the
  // config-validation and pure-scaffolding paths (which never connect) are covered here. Run the rest
  // against a real database before relying on them.

  test("db:pg generate fails clearly when database.config.ts is missing", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "generate", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_PROJECT);
    expect(capture.errors.join("\n")).toContain("CLI3001");
  });

  test("db:pg migration fails clearly when database.config.ts is missing", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migration", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_PROJECT);
    expect(capture.errors.join("\n")).toContain("CLI3001");
  });

  test("db:pg rollback validates step before connecting", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const invalidSteps = ["0", "-1", "1.5", "NaN", "abc"];
    for (const step of invalidSteps) {
      const capture = captureOutput();
      const code = await runCLI(["db:pg", "rollback", `--step=${step}`, "--project", project.root], { output: capture.output });
      expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
      expect(capture.errors.join("\n")).toContain("CLI3004");
    }
  });

  test("db:pg rollback defaults to one step and requires database config", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "rollback", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_PROJECT);
    expect(capture.errors.join("\n")).toContain("CLI3001");
  });

  test("db:pg migration <kind>:<name> scaffolds a timestamped migration file without connecting to a database", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfig(project.root);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migration", "create:table:user", "--project", project.root], { output: capture.output });
    expect(code).toBe(0);
    expect(capture.lines.join("\n")).toContain("Generated");
    const files = [...new Bun.Glob("*.ts").scanSync({ cwd: join(project.root, "database/warbler/pg/migrations") })];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{14}_create_table_user\.ts$/u);
    const content = await Bun.file(join(project.root, "database/warbler/pg/migrations", files[0]!)).text();
    expect(content).toContain('pgm.createTable("users"');
    expect(content).toContain("deletedAt: PgTypes.Timestamp({ nullable: true })");
    expect(content).toContain("{ softDelete: true }");
  });

  test("db:pg migration create:table supports --no-soft-delete without connecting to a database", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfig(project.root);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migration", "create:table:log", "--no-soft-delete", "--project", project.root], { output: capture.output });
    expect(code).toBe(0);
    const files = [...new Bun.Glob("*.ts").scanSync({ cwd: join(project.root, "database/warbler/pg/migrations") })];
    const content = await Bun.file(join(project.root, "database/warbler/pg/migrations", files[0]!)).text();
    expect(content).toContain('pgm.createTable("logs"');
    expect(content).not.toContain("deletedAt");
    expect(content).toContain("{ softDelete: false }");
  });

  test("db:pg migration create:table honors migrations.softDelete false", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfigWithoutSoftDelete(project.root);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migration", "create:table:audit_log", "--project", project.root], { output: capture.output });
    expect(code).toBe(0);
    const files = [...new Bun.Glob("*.ts").scanSync({ cwd: join(project.root, "database/warbler/pg/migrations") })];
    const content = await Bun.file(join(project.root, "database/warbler/pg/migrations", files[0]!)).text();
    expect(content).toContain('pgm.createTable("audit_logs"');
    expect(content).not.toContain("deletedAt");
    expect(content).toContain("{ softDelete: false }");
  });

  test("db:pg rejects an unknown action", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migrate", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(capture.errors.join("\n")).toContain("CLI3002");
  });

  test("db:pg migrate:fresh safely cancels by default before connecting", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfig(project.root);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migrate:fresh", "--seed", "--project", project.root], { output: capture.output });
    expect(code).toBe(0);
    expect(capture.lines.join("\n")).toContain("PostgreSQL migrate:fresh cancelled.");
  });

  test("db:pg migrate:fresh uses one explicit confirmation and rejects --force", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfig(project.root);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "migrate:fresh", "--force", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(capture.errors.join("\n")).toContain("CLI1010");
  });

  test("db:pg seed:run fails clearly when database.config.ts is missing", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "seed:run", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_PROJECT);
    expect(capture.errors.join("\n")).toContain("CLI3001");
  });

  test("db:pg seed:make <name> scaffolds numbered ORM-aware seed files without connecting to a database", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfig(project.root);
    await Bun.write(join(project.root, "database/warbler/pg/seeds/0004_products.seed.ts"), "existing");
    await Bun.write(join(project.root, "database/warbler/pg/seeds/helpers.ts"), "helper");
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "seed:make", "admin_user", "--project", project.root], { output: capture.output });
    expect(code).toBe(0);
    expect(capture.lines.join("\n")).toContain("Generated");
    const files = [...new Bun.Glob("*.seed.ts").scanSync({ cwd: join(project.root, "database/warbler/pg/seeds") })].sort();
    expect(files).toEqual(["0004_products.seed.ts", "0005_admin_user.seed.ts"]);
    const content = await Bun.file(join(project.root, "database/warbler/pg/seeds/0005_admin_user.seed.ts")).text();
    expect(content).toContain("export const seed: PgSeed<WlbPgTransactionClient>");
    expect(content).toContain('from "../generated/client"');
  });

  test("db:pg old seed action is no longer ambiguous", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await writeDatabaseConfig(project.root);
    const capture = captureOutput();
    const code = await runCLI(["db:pg", "seed", "admin_user", "--project", project.root], { output: capture.output });
    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(capture.errors.join("\n")).toContain("CLI3002");
  });
});

describe("process lifecycle", () => {
  test("forwards the exact child exit code without a shell", async () => {
    const owner = new ProcessOwner();
    owner.start(["bun", "-e", "process.exit(3)"], process.cwd());
    expect(await owner.wait()).toBe(3);
  });
});
