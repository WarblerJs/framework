import { describe, expect, spyOn, test } from "bun:test";
import { installFatalErrorHandlers } from "../src/lifecycle/fatal-shutdown";
import type { RuntimeHandle } from "../src";

function fakeRuntime(stop: () => void | Promise<void>): RuntimeHandle {
  return {
    state: "running",
    application: {} as RuntimeHandle["application"],
    rootContainer: {} as RuntimeHandle["rootContainer"],
    graphContainers: [],
    transports: [],
    stop,
  } as unknown as RuntimeHandle;
}

describe("installFatalErrorHandlers", () => {
  test("gracefully stops the Runtime and exits non-zero on an uncaught exception", async () => {
    let stopped = false;
    const runtime = fakeRuntime(async () => { stopped = true; });
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const dispose = installFatalErrorHandlers(runtime);
    try {
      process.emit("uncaughtException", new Error("boom"));
      await Bun.sleep(10);
      expect(stopped).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      dispose();
      exitSpy.mockRestore();
    }
  });

  test("gracefully stops the Runtime and exits non-zero on an unhandled rejection", async () => {
    let stopped = false;
    const runtime = fakeRuntime(async () => { stopped = true; });
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const dispose = installFatalErrorHandlers(runtime);
    try {
      process.emit("unhandledRejection", new Error("boom"), Promise.resolve());
      await Bun.sleep(10);
      expect(stopped).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      dispose();
      exitSpy.mockRestore();
    }
  });

  test("only handles the first fatal event, even if both fire", async () => {
    let calls = 0;
    const runtime = fakeRuntime(async () => { calls += 1; });
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const dispose = installFatalErrorHandlers(runtime);
    try {
      process.emit("uncaughtException", new Error("first"));
      process.emit("unhandledRejection", new Error("second"), Promise.resolve());
      await Bun.sleep(10);
      expect(calls).toBe(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      exitSpy.mockRestore();
    }
  });

  test("the returned disposer removes both listeners", () => {
    const runtime = fakeRuntime(() => {});
    const before = process.listenerCount("uncaughtException");
    const dispose = installFatalErrorHandlers(runtime);
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    dispose();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
