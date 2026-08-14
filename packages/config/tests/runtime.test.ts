import { describe, expect, test } from "bun:test";
import { normalizeLoggingConfig, normalizeProfilingConfig, normalizeRuntimeConfig, validateRuntimeConfig } from "../src";

function runtimeConfig(): unknown {
  return {
    network: { host: "0.0.0.0", bindInterface: undefined },
    transports: {
      http: { enabled: true, port: 3000 },
      websocket: { enabled: true, mode: "shared-http", port: 8443 },
      tcp: { enabled: false, port: 9000 },
      udp: { enabled: false, port: 9001 },
      mcp: { enabled: false, port: 8080 },
      webrtc: { enabled: false, signaling: { port: 3001 } },
    },
    telemetry: {
      metrics: { enabled: true, host: "127.0.0.1", port: 9090, path: "/metrics" },
      healthCheck: { enabled: true, host: "127.0.0.1", port: 8081, path: "/healthz" },
    },
  };
}

describe("runtime configuration", () => {
  test("validates and freezes every normalized level", () => {
    const normalized = normalizeRuntimeConfig(runtimeConfig());
    expect(normalized.network.host).toBe("0.0.0.0");
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.network)).toBe(true);
    expect(Object.isFrozen(normalized.transports)).toBe(true);
    expect(Object.isFrozen(normalized.telemetry.metrics)).toBe(true);
  });

  test("rejects unknown fields", () => {
    const value = runtimeConfig();
    if (typeof value !== "object" || value === null) throw new Error("invalid fixture");
    Object.assign(value, { unexpected: true });
    expect(() => validateRuntimeConfig(value)).toThrow("runtime.unexpected");
  });

  test("rejects missing, unsafe, and malformed values", () => {
    expect(() => validateRuntimeConfig({})).toThrow("runtime.network");
    const invalidPort = runtimeConfig();
    if (typeof invalidPort !== "object" || invalidPort === null || !("transports" in invalidPort)) {
      throw new Error("invalid fixture");
    }
    const transports = invalidPort.transports;
    if (typeof transports !== "object" || transports === null || !("http" in transports)) {
      throw new Error("invalid fixture");
    }
    if (typeof transports.http !== "object" || transports.http === null) {
      throw new Error("invalid fixture");
    }
    Object.assign(transports.http, { port: Infinity });
    expect(() => validateRuntimeConfig(invalidPort)).toThrow("port");
  });
});

describe("logging configuration", () => {
  test("defaults informational logging by environment and keeps errors/fatal enabled", () => {
    expect(normalizeLoggingConfig({ environment: "development" })).toMatchObject({
      requests: true, runtime: true, transports: true, websocket: true, errors: true, fatal: true,
      channels: { console: { enabled: true }, file: { enabled: false, path: "storage/logs", retentionDays: 14 } },
    });
    expect(normalizeLoggingConfig({ environment: "staging" })).toMatchObject({
      requests: true, runtime: true, transports: true, websocket: true, errors: true, fatal: true,
    });
    expect(normalizeLoggingConfig({ environment: "production" })).toMatchObject({
      requests: false, runtime: false, transports: false, websocket: false, errors: true, fatal: true,
    });
  });

  test("explicit logging overrides win over environment defaults", () => {
    expect(normalizeLoggingConfig({
      environment: "production",
      requests: true,
      websocket: true,
      errors: false,
      channels: { file: { enabled: true, path: "storage/errors", retentionDays: 30 } },
    })).toMatchObject({
      requests: true,
      websocket: true,
      errors: false,
      fatal: true,
      channels: { file: { enabled: true, path: "storage/errors", retentionDays: 30, rotation: "daily", cleanup: "internal", format: "pretty" } },
    });
  });

  test("accepts the nested suggested logging object shape", () => {
    expect(normalizeLoggingConfig({
      logging: {
        enabled: true,
        environment: "production",
        channels: { file: { enabled: true } },
      },
    })).toMatchObject({
      requests: false,
      errors: true,
      channels: { file: { enabled: true, path: "storage/logs", retentionDays: 14 } },
    });
  });
});

describe("profiling configuration", () => {
  test("defaults HTTP profiling off and summary-on-stop on", () => {
    expect(normalizeProfilingConfig()).toEqual({ http: false, summaryOnStop: true });
  });

  test("explicit profiling overrides win", () => {
    expect(normalizeProfilingConfig({ http: true, summaryOnStop: false })).toEqual({ http: true, summaryOnStop: false });
  });
});
