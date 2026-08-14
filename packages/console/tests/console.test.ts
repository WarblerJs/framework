import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BufferedDailyFileLogger,
  cleanupExpiredLogs,
  formatDailyLogEntry,
  WarblerConsole,
  createCorrelationId,
  terminalCapabilities,
} from "../src";

function capture(options: Readonly<{ tty?: boolean; mode?: "human" | "json"; color?: boolean; unicode?: boolean; silent?: boolean; verbose?: boolean; noColor?: boolean }> = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const stdout = { isTTY: options.tty ?? false, write(value: string) { lines.push(value); } };
  const stderr = { isTTY: options.tty ?? false, write(value: string) { errors.push(value); } };
  const console = new WarblerConsole({
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.unicode === undefined ? {} : { unicode: options.unicode }),
    ...(options.silent === undefined ? {} : { silent: options.silent }),
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
    stdout,
    stderr,
    environment: options.noColor ? { NO_COLOR: "1", TERM: "xterm" } : { TERM: "xterm" },
  });
  return { console, lines, errors };
}

describe("terminal modes", () => {
  test("uses ANSI only for an enabled TTY and honors NO_COLOR", () => {
    const colored = capture({ tty: true });
    colored.console.success("ready");
    expect(colored.lines.join("")).toContain("\u001b[32m");
    const plain = capture({ tty: false });
    plain.console.success("ready");
    expect(plain.lines.join("")).not.toContain("\u001b");
    const disabled = capture({ tty: true, noColor: true });
    disabled.console.error("failed");
    expect(disabled.errors.join("")).not.toContain("\u001b");
  });

  test("supports Unicode and ASCII rendering", () => {
    const unicode = capture({ unicode: true });
    unicode.console.success("ready");
    expect(unicode.lines.join("")).toContain("✓");
    const ascii = capture({ unicode: false });
    ascii.console.success("ready");
    expect(ascii.lines.join("")).toContain("[OK]");
  });

  test("emits JSON without ANSI and silent mode emits only errors", () => {
    const json = capture({ tty: true, mode: "json" });
    json.console.warning("careful", { code: "WARN" });
    const value = JSON.parse(json.lines[0]!);
    expect(value).toMatchObject({ type: "warning", message: "careful", code: "WARN" });
    expect(json.lines[0]).not.toContain("\u001b");
    const silent = capture({ silent: true });
    silent.console.info("hidden");
    silent.console.error("visible");
    expect(silent.lines).toHaveLength(0);
    expect(silent.errors.join("")).toContain("visible");
  });

  test("verbose mode controls debug and trace", () => {
    const normal = capture();
    normal.console.debug("hidden");
    expect(normal.lines).toHaveLength(0);
    const verbose = capture({ verbose: true });
    verbose.console.debug("debug");
    verbose.console.trace("trace");
    expect(verbose.lines.join("")).toContain("debug");
    expect(verbose.lines.join("")).toContain("trace");
  });
});

describe("professional renderers", () => {
  test("renders banner, table, diagnostics, and lifecycle states", () => {
    const output = capture({ unicode: true });
    output.console.banner({
      version: "0.1.0", project: "playground", build: 15, compilerMs: 44,
      runtimeMs: 18, http: "http://127.0.0.1:3000", websocket: "ws://127.0.0.1:3001/chat",
      network: ["http://localhost:3000", "http://192.168.1.3:3000"],
      watching: ["src", "resources", "public"],
    });
    output.console.table("Routes", { headers: ["Method", "Path"], rows: [["GET", "/"]] });
    output.console.diagnostic({
      source: "compiler", code: "WARBLER1001", severity: "error", message: "Invalid provider",
      file: "src/main.ts", line: 4, column: 2, suggestion: "Export the provider.",
    });
    output.console.runtime("ready");
    const rendered = `${output.lines.join("")}${output.errors.join("")}`;
    expect(rendered).toContain("Warbler");
    expect(rendered).toContain("playground");
    expect(rendered).toContain("┌");
    expect(rendered).toContain("Network");
    expect(rendered).toContain("http://192.168.1.3:3000");
    expect(rendered).toContain("src/main.ts:4:2");
    expect(rendered).toContain("Runtime Ready");
  });

  test("logs correlated HTTP and WebSocket events without payloads", () => {
    const output = capture();
    const request = output.console.request({ method: "GET", path: "/products" });
    output.console.response(request, { status: 200, bytes: 18_200 });
    output.console.socket({ action: "connect", path: "/chat", connectionId: "conn_1", ip: "127.0.0.1" });
    output.console.socket({ action: "incoming", event: "chat.message", connectionId: "conn_1", size: 532 });
    const rendered = output.lines.join("");
    expect(request.requestId).toStartWith("req_");
    expect(rendered).toContain("GET /products");
    expect(rendered).toContain("200 OK");
    expect(rendered).toContain("chat.message");
    expect(rendered).not.toContain("password");
  });

  test("replaces build sections without clearing intervening request logs", () => {
    const output = capture({ tty: true });
    output.console.build({ build: 14, status: "success" });
    const request = output.console.request({ method: "GET", path: "/health" });
    output.console.response(request, { status: 200 });
    output.console.build({ build: 15, status: "success" });
    expect(output.lines.join("")).toContain("GET /health");
    expect(output.lines.join("")).not.toContain("\u001b[2K");
  });
});

describe("timing and IDs", () => {
  test("creates unique typed IDs and performance timers", () => {
    const first = createCorrelationId("req");
    const second = createCorrelationId("req");
    expect(first).not.toBe(second);
    const output = capture({ verbose: true });
    const timer = output.console.timer("Compiler");
    expect(timer.elapsed()).toBeGreaterThanOrEqual(0);
    expect(timer.end()).toBeGreaterThanOrEqual(0);
  });

  test("detects terminal capabilities deterministically", () => {
    expect(terminalCapabilities({
      mode: "human",
      stdout: { isTTY: true, write() {} },
      environment: { TERM: "xterm" },
    })).toEqual({ color: true, unicode: true, dynamic: true });
  });
});

describe("daily file logging", () => {
  test("formats pretty entries with a blank line and divider", () => {
    const entry = formatDailyLogEntry({
      timestamp: new Date("2026-08-14T01:14:32.000Z"),
      level: "ERROR",
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
      message: "Internal Server Error",
      developerMessage: "TypeError: Cannot read properties of undefined",
      stack: "TypeError: Cannot read properties of undefined\n    at src/controllers/user.controller.ts:42:18",
      request: {
        method: "GET",
        path: "/users/42",
        clientIp: "192.168.1.25",
        handler: "UserController.show",
        requestId: "01JWARBLER8F3A",
      },
    });
    expect(entry).toContain("[2026-08-14 01:14:32] ERROR");
    expect(entry).toContain("Code:       INTERNAL_SERVER_ERROR");
    expect(entry).toContain("Request:    GET /users/42");
    expect(entry).toContain("IP:         192.168.1.25");
    expect(entry).toContain("Handler:    UserController.show");
    expect(entry).toContain("Request ID: 01JWARBLER8F3A");
    expect(entry).toContain("- •••••");
    expect(entry.endsWith("\n\n")).toBe(true);
  });

  test("buffers writes, flushes asynchronously, and rotates by entry date", async () => {
    const root = await mkdtemp(join(tmpdir(), "warbler-logs-"));
    const logger = new BufferedDailyFileLogger({
      enabled: true,
      directory: root,
      retentionDays: 14,
      flushIntervalMs: 0,
      now: () => new Date("2026-08-15T00:00:00.000Z"),
    });
    logger.enqueue({
      timestamp: new Date("2026-08-14T23:59:59.000Z"),
      level: "ERROR",
      code: "A",
      status: 500,
      message: "first",
    });
    logger.enqueue({
      timestamp: new Date("2026-08-15T00:00:01.000Z"),
      level: "ERROR",
      code: "B",
      status: 500,
      message: "second",
    });
    await logger.flush();
    expect(await Bun.file(join(root, "warbler-2026-08-14.log")).text()).toContain("Code:       A");
    expect(await Bun.file(join(root, "warbler-2026-08-15.log")).text()).toContain("Code:       B");
    await logger.stop();
  });

  test("removes expired daily logs and keeps current logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "warbler-logs-"));
    await Bun.write(join(root, "warbler-2026-08-01.log"), "old");
    await Bun.write(join(root, "warbler-2026-08-10.log"), "new");
    await Bun.write(join(root, "other.log"), "keep");
    await cleanupExpiredLogs(root, 7, new Date("2026-08-14T12:00:00.000Z"), 1);
    expect(await Bun.file(join(root, "warbler-2026-08-01.log")).exists()).toBe(false);
    expect(await Bun.file(join(root, "warbler-2026-08-10.log")).exists()).toBe(true);
    expect(await Bun.file(join(root, "other.log")).exists()).toBe(true);
  });

  test("redacts secrets before writing", () => {
    const entry = formatDailyLogEntry({
      timestamp: new Date("2026-08-14T01:14:32.000Z"),
      level: "ERROR",
      code: "DB_ERROR",
      status: 500,
      message: "Internal Server Error",
      developerMessage: "password=hunter2 postgres://user:pw@host/db authorization: Bearer abc",
    });
    expect(entry).not.toContain("hunter2");
    expect(entry).not.toContain("postgres://");
    expect(entry).not.toContain("Bearer abc");
    expect(entry).not.toMatch(/\d+\[REDACTED\]/);
    expect(entry).toContain("[REDACTED]");
  });
});
