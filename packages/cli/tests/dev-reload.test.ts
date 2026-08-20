import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ManagedDevSession, type DevelopmentRuntimeHandle, type DevelopmentRuntimeLauncher } from "../src/dev/dev-session";
import { importGeneratedApplication } from "../src/dev/runtime-launcher";
import { startRuntime, type RuntimeTransportLauncher, type RuntimeTransportStartInput } from "@warbler/runtime";
import type { CompilerContext } from "@warbler/compiler";
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
    const controller = join(project.root, "src/graphs/home/home.controller.ts");
    const valid = await Bun.file(controller).text();
    await Bun.write(controller, valid.replace('@Get("/")', '@Get("/changed")'));
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);
    expect(starts).toBe(2);
    expect(stops).toBe(1);

    await session.notifyChanges(["src/config/runtime.config.ts"]);
    expect(stops).toBe(2);
    expect(starts).toBe(3);

    await Bun.write(controller, "this is invalid TypeScript");
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);
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

  test("imports fresh Controller code after a full successful rebuild", async () => {
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
    const controller = join(project.root, "src/graphs/home/home.controller.ts");
    const source = await Bun.file(controller).text();
    await Bun.write(controller, source.replace('{ message: "Warbler" }', '{ message: "Fresh" }'));
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);
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

    const controller = join(project.root, "src/graphs/home/home.controller.ts");
    const graph = join(project.root, "src/graphs/home/home.graph.ts");
    const source = await Bun.file(controller).text();
    await Bun.write(controller, source.replace('@Get("/")', '@Get("/cached")'));
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);

    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.program.getSourceFile(controller)).not.toBe(contexts[0]!.program.getSourceFile(controller));
    expect(contexts[1]!.program.getSourceFile(graph)).toBe(contexts[0]!.program.getSourceFile(graph));
    await session.stop();
  }, 20_000);

  test("imports fresh compiled validator bindings after a full Runtime restart", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    const controller = join(project.root, "src/graphs/home/home.controller.ts");
    const source = `import { Controller, JsonRes, Post, type AppRequest } from "@warbler/http";
import { defineValidator, v, type InferValidatorOutput } from "@warbler/validators";
export const PayloadValidator = defineValidator({
  rules: { value: v.string("invalid_string").max(3, "too_long") },
});
type Payload = InferValidatorOutput<typeof PayloadValidator>;
@Controller()
export default class HomeController {
  @Post("/", { validator: PayloadValidator, csrf: false })
  index(input: unknown): Response {
    const request = input as AppRequest<Payload>;
    return JsonRes({ value: request.body.value });
  }
}
`;
    await Bun.write(controller, source);
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

    await Bun.write(controller, source.replace(".max(3,", ".max(10,"));
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);
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
    const first = session.notifyChanges(["src/graphs/home/home.controller.ts"]);
    await restartEntered.promise;
    const second = session.notifyChanges([
      "src/graphs/home/home.controller.ts",
      "src/graphs/home/home.controller.ts",
    ]);
    releaseRestart.resolve();
    await Promise.all([first, second]);
    expect(session.buildNumber).toBe(3);
    expect(starts).toBe(3);
    await session.stop();
  }, 20_000);
});

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
