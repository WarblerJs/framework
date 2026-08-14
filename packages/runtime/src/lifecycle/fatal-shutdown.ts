import { loadLoggingConfig, normalizeLoggingConfig } from "@warbler/config";
import { Console } from "@warbler/console";
import { normalizeError } from "@warbler/core";
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
        const normalized = normalizeError(error);
        Console.error("Fatal process error.", {
          message: normalized.developerMessage ?? normalized.message,
        });
        const report: {
          code: string;
          status: number;
          message: string;
          developerMessage?: string;
          stack?: string;
          fatal: boolean;
          cause: unknown;
        } = {
          code: normalized.code,
          status: normalized.status,
          message: normalized.message,
          fatal: normalized.fatal,
          cause: normalized.cause,
        };
        if (normalized.developerMessage !== undefined) report.developerMessage = normalized.developerMessage;
        if (normalized.stack !== undefined) report.stack = normalized.stack;
        const context: { transport: string; requestId?: string } = {
          transport: "process",
        };
        if (normalized.requestId !== undefined) context.requestId = normalized.requestId;
        Console.errorReport(report, Object.freeze(context));
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
