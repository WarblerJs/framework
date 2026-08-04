import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ManagedDevSession, type DevelopmentRuntimeHandle, type DevelopmentRuntimeLauncher } from "../src/dev/dev-session";
import { importGeneratedApplication } from "../src/dev/runtime-launcher";
import { startRuntime, type RuntimeTransportLauncher, type RuntimeTransportStartInput } from "@warbler/runtime";
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
});
