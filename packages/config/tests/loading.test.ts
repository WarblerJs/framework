import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  loadRuntimeConfig,
  loadTransportConfig,
} from "../src";
import { discoverRuntimeConfig, discoverTransportConfig } from "../src/discovery";

const WORKSPACE_ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/u, "");

describe("configuration discovery and loading", () => {
  test("discovers conventional files", async () => {
    expect(await discoverRuntimeConfig(WORKSPACE_ROOT)).toEndWith("playground/src/config/runtime.config.ts");
    expect(await discoverTransportConfig("websocket", WORKSPACE_ROOT)).toEndWith(
      "playground/src/config/transports/ws.config.ts",
    );
  });

  test("loads and normalizes runtime configuration", async () => {
    const runtime = await loadRuntimeConfig(WORKSPACE_ROOT);
    expect(runtime.transports.http.enabled).toBe(true);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  test("loads only enabled transport configuration", async () => {
    const runtime = await loadRuntimeConfig(WORKSPACE_ROOT);
    const http = await loadTransportConfig("http", runtime, WORKSPACE_ROOT);
    expect(http).toBeDefined();
    expect(Object.isFrozen(http)).toBe(true);
    expect(await loadTransportConfig("tcp", runtime, "/path/that/does/not/exist")).toBeUndefined();
  });

  test("reports missing configuration paths", async () => {
    expect(discoverRuntimeConfig("/path/that/does/not/exist")).rejects.toBeInstanceOf(ConfigError);
  });
});
