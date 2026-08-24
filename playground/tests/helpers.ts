import { compileProject } from "@warblerjs/compiler";
import type { GeneratedApplicationBindings, RuntimeHandle } from "@warblerjs/runtime";
import { startRuntime } from "@warblerjs/runtime";
import type { RuntimeTransportLauncher, RuntimeTransportStartInput } from "@warblerjs/transport";
import { join } from "node:path";

export const playgroundRoot = join(import.meta.dir, "..");

export async function generatedApplication(): Promise<GeneratedApplicationBindings> {
  const result = await compileProject(playgroundRoot);
  if (result.applicationEntry === undefined || result.fingerprint === undefined) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  const module: unknown = await import(`${result.applicationEntry}?test=${result.fingerprint}`);
  if (typeof module !== "object" || module === null || !("default" in module)) throw new Error("Generated application export missing");
  return module.default as GeneratedApplicationBindings;
}

export async function startCaptured(
  enabled: "http" | "websocket",
  capture: (bindings: unknown) => void,
): Promise<RuntimeHandle> {
  const launcher: RuntimeTransportLauncher = Object.freeze({
    kind: enabled,
    start(input: RuntimeTransportStartInput) {
      capture(input.bindings);
      return Object.freeze({});
    },
  });
  return startRuntime({
    application: await generatedApplication(),
    runtimeConfig: {
      network: { host: "127.0.0.1" },
      transports: {
        http: { enabled: enabled === "http", port: 3000 },
        websocket: { enabled: enabled === "websocket", mode: "standalone", port: 3001 },
        tcp: { enabled: false },
        udp: { enabled: false },
        mcp: { enabled: false },
        webrtc: { enabled: false },
      },
      telemetry: {
        metrics: { enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" },
        healthCheck: { enabled: false, host: "127.0.0.1", port: 8081, path: "/healthz" },
      },
    },
    transportLaunchers: [launcher],
    transportConfigLoader: async () => Object.freeze({}),
    workspaceRoot: playgroundRoot,
  });
}
