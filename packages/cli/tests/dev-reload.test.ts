import { afterEach, describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ManagedDevSession, type DevelopmentRuntimeHandle, type DevelopmentRuntimeLauncher } from "../src/dev/dev-session";
import { importGeneratedApplication } from "../src/dev/runtime-launcher";
import { startRuntime, type RuntimeTransportLauncher, type RuntimeTransportStartInput } from "@warblerjs/runtime";
import { compileProject, type CompilerContext } from "@warblerjs/compiler";
import { createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("managed development reload", () => {
  test("reloads route changes, restarts configuration changes, preserves Runtime on compile failure, and cleans up", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let starts = 0; let stops = 0;
    const launcher: DevelopmentRuntimeLauncher = {
      start(): DevelopmentRuntimeHandle {
        starts++;
        return {
          stop() { stops++; },
        };
      },
    };
    const events: import("../src").DevelopmentEvent[] = [];
    const session = await new ManagedDevSession(project.root, launcher, false, {}, (event) => events.push(event)).start();
    const graph = join(project.root, "src/graphs/home/home.graph.ts");
    const handler = join(project.root, "src/graphs/home/presentation/http/handlers/home.handlers.ts");
    const valid = await Bun.file(graph).text();
    await Bun.write(graph, valid.replace('"GET /":', '"GET /changed":'));
    await session.notifyChanges(["src/graphs/home/home.graph.ts"]);
    expect(starts).toBe(2);
    expect(stops).toBe(1);

    await session.notifyChanges(["src/config/runtime.config.ts"]);
    expect(stops).toBe(2);
    expect(starts).toBe(3);

    await Bun.write(handler, "this is invalid TypeScript");
    await session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);
    expect(starts).toBe(3);
    expect(session.state).toBe("running");
    expect(events.some((event) => event.stage === "compiler" && event.status === "failure")).toBe(true);
    expect(events.some((event) => event.stage === "rebuild" && event.status === "failure")).toBe(true);
    expect(await Bun.file(join(project.root, ".warbler/diagnostics/compiler.json")).exists()).toBe(true);

    await session.stop();
    expect(session.state).toBe("stopped");
    expect(stops).toBe(3);
  }, 20_000);

  test("static and view changes do not restart Runtime", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let starts = 0; let stops = 0;
    const session = await new ManagedDevSession(project.root, {
      start() { starts++; return { stop() { stops++; } }; },
    }, false).start();
    await session.notifyChanges(["public/app.css", "resources/views/index.html"]);
    expect(starts).toBe(1);
    expect(stops).toBe(0);
    await session.stop();
  });

  test("translation catalog changes replace Runtime so no stale catalog remains", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let starts = 0;
    let stops = 0;
    const session = await new ManagedDevSession(project.root, {
      start() { starts++; return { stop() { stops++; } }; },
    }, false).start();
    await session.notifyChanges(["resources/i18n/en/validators.json"]);
    expect(starts).toBe(2);
    expect(stops).toBe(1);
    await session.stop();
    expect(stops).toBe(2);
  });

  test("restores the previous valid Runtime when a new Runtime restart fails", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let starts = 0;
    let stops = 0;
    const session = await new ManagedDevSession(project.root, {
      start() {
        starts++;
        if (starts === 2) throw new Error("new Runtime failed");
        return { stop() { stops++; } };
      },
    }, false).start();
    await session.notifyChanges(["src/config/runtime.config.ts"]);
    expect(starts).toBe(3);
    expect(stops).toBe(1);
    expect(session.state).toBe("running");
    await session.stop();
    expect(stops).toBe(2);
  });

  test("imports fresh handler code after a full successful rebuild", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    const transport: RuntimeTransportLauncher = Object.freeze({
      kind: "http",
      start(input: RuntimeTransportStartInput) {
        routes = (input.bindings as Readonly<{ routes: typeof routes }>).routes;
        return Object.freeze({});
      },
    });
    const launcher: DevelopmentRuntimeLauncher = {
      async start(_root, compiler) {
        const application = await importGeneratedApplication(compiler.applicationEntry!, compiler.fingerprint!);
        const runtime = await startRuntime({
          application,
          runtimeConfig: {
            network: { host: "127.0.0.1" },
            transports: {
              http: { enabled: true, port: 3000 }, websocket: { enabled: false },
              tcp: { enabled: false }, udp: { enabled: false }, mcp: { enabled: false }, webrtc: { enabled: false },
            },
            telemetry: {
              metrics: { enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" },
              healthCheck: { enabled: false, host: "127.0.0.1", port: 8081, path: "/healthz" },
            },
          },
          transportLaunchers: [transport],
          transportConfigLoader: async () => Object.freeze({}),
        });
        return { stop: () => runtime.stop() };
      },
    };
    const session = await new ManagedDevSession(project.root, launcher, false).start();
    const before = await routes["/"]!.GET!(new Request("http://127.0.0.1/"));
    expect(await before.json()).toEqual({ message: "Warbler" });
    const handler = join(project.root, "src/graphs/home/presentation/http/handlers/home.handlers.ts");
    const source = await Bun.file(handler).text();
    await Bun.write(handler, source.replace('"Warbler"', '"Fresh"'));
    await session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);
    const after = await routes["/"]!.GET!(new Request("http://127.0.0.1/"));
    expect(await after.json()).toEqual({ message: "Fresh" });
    expect(session.buildNumber).toBe(2);
    await session.stop();
  }, 20_000);

  test("reuses compiler SourceFiles that were not invalidated by a rebuild", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const contexts: CompilerContext[] = [];
    const session = await new ManagedDevSession(project.root, {
      start(_root, compiler) {
        contexts.push(compiler);
        return { stop() {} };
      },
    }, false).start();

    const handler = join(project.root, "src/graphs/home/presentation/http/handlers/home.handlers.ts");
    const graph = join(project.root, "src/graphs/home/home.graph.ts");
    const source = await Bun.file(handler).text();
    await Bun.write(handler, source.replace('"Warbler"', '"Cached"'));
    await session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);

    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.program.getSourceFile(handler)).not.toBe(contexts[0]!.program.getSourceFile(handler));
    expect(contexts[1]!.program.getSourceFile(graph)).toBe(contexts[0]!.program.getSourceFile(graph));
    expect(contexts[1]!.applicationWIR).toBe(contexts[0]!.applicationWIR);
    expect(contexts[1]!.generatedApplication).toBe(contexts[0]!.generatedApplication);
    await session.stop();
  }, 20_000);

  test("reuses Warbler pipeline state for code-only handler changes while emitting a fresh build entry", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const contexts: CompilerContext[] = [];
    const session = await new ManagedDevSession(project.root, {
      start(_root, compiler) {
        contexts.push(compiler);
        return { stop() {} };
      },
    }, false).start();

    const handler = join(project.root, "src/graphs/home/presentation/http/handlers/home.handlers.ts");
    const generatedTable = join(project.root, ".warbler/generated/tables.generated.ts");
    const generatedTableMtime = (await stat(generatedTable)).mtimeMs;
    const source = await Bun.file(handler).text();
    await Bun.write(handler, source.replace('"Warbler"', '"Fresh"'));
    await session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);

    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.applicationWIR).toBe(contexts[0]!.applicationWIR);
    expect(contexts[1]!.generatedApplication).toBe(contexts[0]!.generatedApplication);
    expect(contexts[1]!.fingerprint).not.toBe(contexts[0]!.fingerprint);
    expect(contexts[1]!.applicationEntry).not.toBe(contexts[0]!.applicationEntry);
    const snapshot = await Bun.file(join(project.root, ".warbler/generated", `build-${contexts[1]!.fingerprint}`, "source/src/graphs/home/presentation/http/handlers/home.handlers.ts")).text();
    expect(snapshot).toContain('const message = "Fresh"');
    expect((await stat(generatedTable)).mtimeMs).toBe(generatedTableMtime);

    const fresh = await compileProject(project.root, { semanticDiagnostics: false });
    expect(contexts[1]!.fingerprint).toBe(fresh.fingerprint);
    expect(contexts[1]!.generatedApplication!.files).toEqual(fresh.generatedApplication!.files);

    const secondSource = await Bun.file(handler).text();
    await Bun.write(handler, secondSource.replace('"Fresh"', '"Fresh Again"'));
    await session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);
    expect(contexts).toHaveLength(3);
    expect(contexts[2]!.applicationWIR).toBe(contexts[0]!.applicationWIR);
    expect(contexts[2]!.generatedApplication).toBe(contexts[0]!.generatedApplication);
    expect(contexts[2]!.fingerprint).not.toBe(contexts[1]!.fingerprint);
    const secondFresh = await compileProject(project.root, { semanticDiagnostics: false });
    expect(contexts[2]!.fingerprint).toBe(secondFresh.fingerprint);
    await session.stop();
  }, 20_000);

  test("repeated declarative graph reloads do not retain unbounded compiler or runtime state", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    await Bun.write(join(project.root, "src/main.ts"), `import { createApp, Transport } from "@warblerjs/core";
export default createApp({
  transports: [Transport.HTTP],
  graphs: "src/graphs/**/*.graph.ts",
});
`);
    await Bun.write(join(project.root, "src/graphs/test/test.handlers.ts"), declarativeHandlerSource(0));
    await Bun.write(join(project.root, "src/graphs/test/test.graph.ts"), `import { defineHttpGraph } from "@warblerjs/http";
import * as handlers from "./test.handlers";
export default defineHttpGraph({
  prefix: "/api",
  routes: {
    "GET /test": handlers.getTest,
  },
});
`);
    let starts = 0;
    let stops = 0;
    const samples: number[] = [];
    const session = await new ManagedDevSession(project.root, {
      start() {
        starts++;
        return { stop() { stops++; } };
      },
    }, false).start();

    forceGc();
    samples.push(process.memoryUsage().heapUsed);
    for (let index = 1; index <= 12; index++) {
      await Bun.write(join(project.root, "src/graphs/test/test.handlers.ts"), declarativeHandlerSource(index));
      await session.notifyChanges(["src/graphs/test/test.handlers.ts"]);
      forceGc();
      samples.push(process.memoryUsage().heapUsed);
    }

    await session.stop();
    expect(starts).toBe(13);
    expect(stops).toBe(13);
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(64 * 1024 * 1024);
  }, 30_000);

  test("imports fresh compiled validator bindings after a full Runtime restart", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const graph = join(project.root, "src/graphs/home/home.graph.ts");
    await Bun.write(graph, `import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/home.handlers";

export default defineHttpGraph({
  prefix: "/",
  middlewares: [],
  providers: [],
  routes: {
    "POST /": {
      name: "home.submit",
      handler: handlers.index,
    },
  },
});
`);
    const handler = join(project.root, "src/graphs/home/presentation/http/handlers/home.handlers.ts");
    const source = `import { defineHandler, defineValidator, JsonRes, v, type AppRequest } from "@warblerjs/framework";

export const PayloadValidator = defineValidator({
  rules: { value: v.string("invalid_string").max(3, "too_long") },
});

export const index = defineHandler({
  validator: PayloadValidator,
  run: (request: AppRequest<typeof PayloadValidator>) => JsonRes({ value: request.body.value }),
});
`;
    await Bun.write(handler, source);
    let routes: Readonly<Record<string, Readonly<Record<string, (request: Request) => Response | Promise<Response>>>>> = Object.freeze({});
    let starts = 0;
    let stops = 0;
    const transport: RuntimeTransportLauncher = Object.freeze({
      kind: "http",
      start(input: RuntimeTransportStartInput) {
        routes = (input.bindings as Readonly<{ routes: typeof routes }>).routes;
        return Object.freeze({});
      },
    });
    const launcher: DevelopmentRuntimeLauncher = {
      async start(root, compiler) {
        starts++;
        const application = await importGeneratedApplication(compiler.applicationEntry!, compiler.fingerprint!);
        const runtime = await startRuntime({
          application,
          runtimeConfig: testRuntimeConfig(),
          transportLaunchers: [transport],
          transportConfigLoader: async () => Object.freeze({}),
          workspaceRoot: root,
        });
        return { async stop() { stops++; await runtime.stop(); } };
      },
    };
    const session = await new ManagedDevSession(project.root, launcher, false).start();
    expect((await routes["/"]!.POST!(jsonRequest("four"))).status).toBe(400);

    await Bun.write(handler, source.replace(".max(3,", ".max(10,"));
    await session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);
    const response = await routes["/"]!.POST!(jsonRequest("four"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: "four" });
    expect(starts).toBe(2);
    expect(stops).toBe(1);
    expect(session.buildNumber).toBe(2);
    await session.stop();
    expect(stops).toBe(2);
  }, 20_000);

  test("queues exactly one follow-up build when a change arrives during restart", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const restartEntered = Promise.withResolvers<void>();
    const releaseRestart = Promise.withResolvers<void>();
    let starts = 0;
    const session = await new ManagedDevSession(project.root, {
      async start() {
        starts++;
        if (starts === 2) {
          restartEntered.resolve();
          await releaseRestart.promise;
        }
        return { stop() {} };
      },
    }, false).start();
    const first = session.notifyChanges(["src/graphs/home/presentation/http/handlers/home.handlers.ts"]);
    await restartEntered.promise;
    const second = session.notifyChanges([
      "src/graphs/home/presentation/http/handlers/home.handlers.ts",
      "src/graphs/home/presentation/http/handlers/home.handlers.ts",
    ]);
    releaseRestart.resolve();
    await Promise.all([first, second]);
    expect(session.buildNumber).toBe(3);
    expect(starts).toBe(3);
    await session.stop();
  }, 20_000);
});

function declarativeHandlerSource(version: number): string {
  return `import { defineHandler } from "@warblerjs/core";
import { JsonRes, type AppRequest } from "@warblerjs/http";
export const getTest = defineHandler({
  run: (_ctx: AppRequest) => JsonRes({ version: ${version} }),
});
`;
}
function forceGc(): void {
  const gc = Bun.gc;
  if (typeof gc === "function") gc(true);
}
function jsonRequest(value: string): Request {
  return new Request("http://127.0.0.1/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}
function testRuntimeConfig(): Readonly<Record<string, unknown>> {
  return {
    network: { host: "127.0.0.1" },
    transports: {
      http: { enabled: true, port: 3000 }, websocket: { enabled: false },
      tcp: { enabled: false }, udp: { enabled: false }, mcp: { enabled: false }, webrtc: { enabled: false },
    },
    telemetry: {
      metrics: { enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" },
      healthCheck: { enabled: false, host: "127.0.0.1", port: 8081, path: "/healthz" },
    },
  };
}
