import { describe, expect, test } from "bun:test";
import type { RuntimeExecutionContext, RuntimeTransportStartInput } from "@warbler/transport";
import { createWebSocketRuntimeLauncher } from "../src/runtime-launcher";
import type { WebSocketConfig } from "../src/config";

const runtime: RuntimeExecutionContext = {
  resolveProvider: () => undefined,
  invokeHandler: () => undefined,
};

function startInput(config: WebSocketConfig & { readonly port?: number; readonly host?: string }): RuntimeTransportStartInput<{ dispatch: () => void }, WebSocketConfig> {
  return Object.freeze({
    bindings: { dispatch: () => {} },
    config: config as WebSocketConfig,
    runtime,
    signal: new AbortController().signal,
  });
}

describe("createWebSocketRuntimeLauncher", () => {
  test("binds the dedicated server to the configured host, not a wildcard default", async () => {
    const launcher = createWebSocketRuntimeLauncher();
    const port = 39_000 + Math.floor(Math.random() * 1_000);
    const handle = await launcher.start(startInput({ mode: "dedicated", port, host: "127.0.0.1" }));
    try {
      expect(handle.server.hostname).toBe("127.0.0.1");
    } finally {
      await launcher.stop?.(handle, {});
    }
  });

  test("throws for a non-dedicated mode", () => {
    const launcher = createWebSocketRuntimeLauncher();
    expect(() => launcher.start(startInput({ mode: "shared-http", port: 0, host: "127.0.0.1" }))).toThrow(TypeError);
  });
});
