import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ManagedDevSession, type DevelopmentRuntimeHandle, type DevelopmentRuntimeLauncher } from "../src/dev/dev-session";
import { createTestProject } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("managed development reload", () => {
  test("reloads route changes, restarts configuration changes, preserves Runtime on compile failure, and cleans up", async () => {
    const project = await createTestProject(); cleanup.push(project.cleanup);
    let starts = 0; let stops = 0; let reloads = 0;
    const launcher: DevelopmentRuntimeLauncher = {
      start(): DevelopmentRuntimeHandle {
        starts++;
        return {
          stop() { stops++; },
          reload() { reloads++; return true; },
        };
      },
    };
    const session = await new ManagedDevSession(project.root, launcher, false).start();
    const controller = join(project.root, "src/graphs/home/home.controller.ts");
    const valid = await Bun.file(controller).text();
    await Bun.write(controller, valid.replace('@Get("/")', '@Get("/changed")'));
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);
    expect(reloads).toBe(1);
    expect(starts).toBe(1);

    await session.notifyChanges(["src/config/runtime.config.ts"]);
    expect(stops).toBe(1);
    expect(starts).toBe(2);

    await Bun.write(controller, "this is invalid TypeScript");
    await session.notifyChanges(["src/graphs/home/home.controller.ts"]);
    expect(starts).toBe(2);
    expect(session.state).toBe("running");
    expect(await Bun.file(join(project.root, ".warbler/diagnostics/compiler.json")).exists()).toBe(true);

    await session.stop();
    expect(session.state).toBe("stopped");
    expect(stops).toBe(2);
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
});
