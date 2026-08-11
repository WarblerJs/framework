import { loadLoggingConfig, normalizeLoggingConfig } from "@warbler/config";
import { Console } from "@warbler/console";
import type { RuntimeHandle } from "./runtime-owner";

/**
 * Opt-in, last-resort safety net for genuinely fatal process-level failures — a bug that
 * escapes every per-request/per-connection exception boundary (HTTP, WebSocket, SSE all
 * normalize and contain their own failures; this is for whatever they didn't). Logs,
 * gracefully stops the Runtime (reusing its existing `stop()` shutdown sequence — closes
 * transports/resources, does not force-kill in-flight work beyond that), then exits
 * non-zero. "Runtime/bootstrap owns process termination": this is deliberately **not**
 * wired automatically by `startRuntime`/`GeneratedRuntimeOwner`, since that class is also
 * constructed directly by `bun:test` — installing a real `process.exit()` handler there
 * would risk killing an unrelated test run. Call this explicitly only from a real,
 * standalone process entrypoint (the CLI's generated production `server.js`).
 */
export function installFatalErrorHandlers(runtime: RuntimeHandle): () => void {
  let handled = false;

  const handleFatal = (error: unknown): void => {
    if (handled) return;
    handled = true;
    void loadLoggingConfig(process.cwd()).catch(() => normalizeLoggingConfig({ environment: process.env.NODE_ENV === "production" ? "production" : "development" })).then((logging) => {
      if (logging.fatal) {
        Console.error("Fatal process error.", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    void Promise.resolve(runtime.stop({ reason: "fatal-error" })).finally(() => {
      process.exit(1);
    });
  };

  process.on("uncaughtException", handleFatal);
  process.on("unhandledRejection", handleFatal);

  return () => {
    process.off("uncaughtException", handleFatal);
    process.off("unhandledRejection", handleFatal);
  };
}
