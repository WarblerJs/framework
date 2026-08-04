import { describe, expect, test } from "bun:test";
import { WarblerConsole, createCorrelationId, terminalCapabilities } from "../src";

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
