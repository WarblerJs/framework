import { ANSI, paint } from "./colors/ansi";
import {
  BufferedDailyFileLogger,
  type DailyFileLoggerConfig,
  type ErrorLogEntry,
  type ErrorLogRequestContext,
} from "./daily-file-logger";
import { createCorrelationId } from "./ids/create-id";
import { renderTable } from "./render/table";
import { terminalCapabilities, type TerminalCapabilities } from "./tty/terminal-capabilities";
import type {
  BannerInput,
  BuildInput,
  ConsoleLevel,
  ConsoleMode,
  ConsoleOptions,
  ConsoleWriter,
  DiagnosticInput,
  RequestHandle,
  RequestStartInput,
  ResponseInput,
  SocketLogInput,
  TableInput,
  Timer,
} from "./types";

interface SectionRecord { readonly lines: number; readonly generation: number }
export interface ProgressHandle {
  readonly label: string;
  update(message: string): void;
  complete(message?: string): void;
  fail(message?: string): void;
}

/** Stateful developer-console renderer with immutable configuration snapshots. */
export class WarblerConsole {
  #options: Readonly<ConsoleOptions>;
  #capabilities: TerminalCapabilities;
  #stdout: ConsoleWriter;
  #stderr: ConsoleWriter;
  #generation = 0;
  #fileLogger: BufferedDailyFileLogger | undefined;
  readonly #sections = new Map<string, SectionRecord>();

  public constructor(options: ConsoleOptions = {}) {
    this.#options = Object.freeze({ ...options });
    this.#stdout = options.stdout ?? process.stdout;
    this.#stderr = options.stderr ?? process.stderr;
    this.#capabilities = terminalCapabilities({ ...options, stdout: this.#stdout });
  }

  public configure(options: ConsoleOptions): this {
    this.#options = Object.freeze({ ...options });
    this.#stdout = options.stdout ?? process.stdout;
    this.#stderr = options.stderr ?? process.stderr;
    this.#capabilities = terminalCapabilities({ ...options, stdout: this.#stdout });
    return this;
  }
  public configureDailyFileLogger(config: DailyFileLoggerConfig | undefined): this {
    const previous = this.#fileLogger;
    this.#fileLogger = config === undefined || !config.enabled ? undefined : new BufferedDailyFileLogger(config);
    if (previous !== undefined) void previous.stop();
    return this;
  }
  public errorReport(
    error: Readonly<{
      readonly code: string;
      readonly status: number;
      readonly message: string;
      readonly developerMessage?: string | undefined;
      readonly stack?: string | undefined;
      readonly fatal?: boolean | undefined;
      readonly cause?: unknown;
    }>,
    context: ErrorLogRequestContext = {},
  ): void {
    const level = error.fatal === true ? "FATAL" : "ERROR";
    const entry: {
      timestamp: Date;
      level: "ERROR" | "FATAL";
      code: string;
      status: number;
      message: string;
      developerMessage?: string;
      stack?: string;
      cause?: unknown;
      request: ErrorLogRequestContext;
    } = {
      timestamp: new Date(),
      level,
      code: error.code,
      status: error.status,
      message: error.message,
      request: context,
    };
    if (error.developerMessage !== undefined) entry.developerMessage = error.developerMessage;
    if (error.stack !== undefined) entry.stack = error.stack;
    if (error.cause !== undefined) entry.cause = error.cause;
    this.#fileLogger?.enqueue(Object.freeze(entry) satisfies ErrorLogEntry);
  }
  public async flushDailyFileLogger(): Promise<void> {
    await this.#fileLogger?.flush();
  }
  public async stopDailyFileLogger(): Promise<void> {
    await this.#fileLogger?.stop();
    this.#fileLogger = undefined;
  }
  public get mode(): ConsoleMode { return this.#options.mode ?? "human"; }
  public get colorEnabled(): boolean { return this.#capabilities.color; }
  public get unicodeEnabled(): boolean { return this.#capabilities.unicode; }

  public raw(message: string, error = false): void {
    if (this.#options.silent && !error) return;
    this.#write(`${message}\n`, error);
  }
  public success(message: string, metadata?: Readonly<Record<string, unknown>>): void { this.#level("success", message, metadata); }
  public error(message: string, metadata?: Readonly<Record<string, unknown>>): void { this.#level("error", message, metadata); }
  public warning(message: string, metadata?: Readonly<Record<string, unknown>>): void { this.#level("warning", message, metadata); }
  public info(message: string, metadata?: Readonly<Record<string, unknown>>): void { this.#level("info", message, metadata); }
  public debug(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    if (this.#options.verbose) this.#level("debug", message, metadata);
  }
  public trace(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    if (this.#options.verbose) this.#level("trace", message, metadata);
  }
  public blank(): void {
    if (this.mode === "human" && !this.#options.silent) this.#write("\n");
  }
  public separator(character?: string): void {
    if (this.#options.silent) return;
    const symbol = character ?? (this.#capabilities.unicode ? "─" : "-");
    this.#emit("separator", { value: symbol.repeat(60) }, [paint(this.#capabilities.color, ANSI.gray, symbol.repeat(60))]);
  }
  public section(title: string): void {
    if (this.#options.silent) return;
    this.#emit("section", { title }, [paint(this.#capabilities.color, ANSI.cyan, title)]);
  }
  public table(title: string, input: TableInput): void {
    if (this.#options.silent) return;
    const lines = [title, ...renderTable(input, this.#capabilities.unicode)];
    this.#emit("table", { title, headers: input.headers, rows: input.rows }, lines);
  }
  public banner(input: BannerInput): void {
    if (this.#options.silent) return;
    const bird = this.#capabilities.unicode ? "🐦 " : "";
    const rule = (this.#capabilities.unicode ? "═" : "=").repeat(62);
    const entries: Array<readonly [string, string | number | undefined]> = [
      ["Warbler Framework", input.frameworkVersion], ["Warbler CLI", input.cliVersion],
      ["Bun", input.bunVersion ?? Bun.version], ["Project", input.project],
      ["Build", input.build === undefined ? undefined : `#${input.build}`],
      ["Compiler", duration(input.compilerMs)], ["Runtime", duration(input.runtimeMs)],
      ["HTTP", input.http], ["WebSocket", input.websocket],
    ];
    const labelWidth = 19;
    const lines = [
      rule,
      "",
      center(`${bird}${input.title ?? "Warbler"}`, 62),
      center(input.subtitle ?? "Development Runtime", 62),
      "",
      ...entries.filter((entry) => entry[1] !== undefined).map(([key, value]) => ` ${key.padEnd(labelWidth)} ${String(value)}`),
      ...(input.network === undefined || input.network.length === 0 ? [] : ["", " Network", ...input.network.map((url) => ` ${this.#mark("success")} ${url}`)]),
      ...(input.watching === undefined ? [] : ["", " Watching", ...input.watching.map((path) => ` ${this.#mark("success")} ${path}`)]),
      "",
      rule,
    ];
    this.#emit("banner", input, lines);
  }
  public timer(label: string, metadata?: Readonly<Record<string, unknown>>): Timer {
    const startedAt = performance.now();
    const id = createCorrelationId("compile");
    if (this.#options.verbose) this.debug(`${label} started.`, { id, ...metadata });
    return Object.freeze({
      id,
      startedAt,
      elapsed: () => performance.now() - startedAt,
      end: (endMetadata?: Readonly<Record<string, unknown>>): number => {
        const elapsed = performance.now() - startedAt;
        if (this.#options.verbose) this.debug(`${label} completed.`, { id, duration: round(elapsed), ...metadata, ...endMetadata });
        return elapsed;
      },
    });
  }
  public progress(label: string): ProgressHandle {
    const name = `progress:${createCorrelationId("compile")}`;
    if (!this.#options.silent) this.replaceSection(name, [`${this.#mark("info")} ${label}...`], { label });
    return Object.freeze({
      label,
      update: (message: string): void => {
        if (this.#options.verbose) this.replaceSection(name, [`${this.#mark("info")} ${message}`], { label, message });
      },
      complete: (message = label): void => { this.clearSection(name); this.success(message); },
      fail: (message = label): void => { this.clearSection(name); this.error(message); },
    });
  }
  public request(input: RequestStartInput): RequestHandle {
    const handle = Object.freeze({
      requestId: input.requestId ?? createCorrelationId("req"),
      method: input.method.toUpperCase(),
      path: input.path,
      startedAt: performance.now(),
    });
    if (!this.#options.silent) {
      this.#emit("request", handle, [
        `${this.#symbol("→", ">")} ${handle.method} ${handle.path}`,
        paint(this.#capabilities.color, ANSI.gray, `requestId=${handle.requestId}`),
      ]);
    }
    return handle;
  }
  public response(request: RequestHandle, input: ResponseInput): void {
    if (this.#options.silent && input.status < 500) return;
    const elapsed = round(performance.now() - request.startedAt);
    const metadata = {
      requestId: request.requestId, method: request.method, path: request.path,
      status: input.status, duration: elapsed, ...(input.bytes === undefined ? {} : { bytes: input.bytes }),
      ...(input.code === undefined ? {} : { code: input.code }),
    };
    const color = input.status >= 500 ? ANSI.red : input.status >= 400 ? ANSI.yellow : ANSI.green;
    // this.#emit("response", metadata, [
    //   paint(this.#capabilities.color, color, `${this.#symbol("←", "<")} ${request.method} ${request.path}`),
    //   `${input.status} ${statusText(input.status)}`,
    //   paint(this.#capabilities.color, ANSI.gray, `${elapsed.toFixed(2)} ms${input.bytes === undefined ? "" : `  ${formatBytes(input.bytes)}`}`),
    //   paint(this.#capabilities.color, ANSI.gray, `requestId=${request.requestId}${input.code === undefined ? "" : `  code=${input.code}`}`),
    // ], input.status >= 500);
    const line = [
      paint(
        this.#capabilities.color,
        color,
        `${this.#symbol("←", "<")} ${request.method}`
      ),
      paint(
        this.#capabilities.color,
        ANSI.cyan,
        request.path,
      ),
      paint(
        this.#capabilities.color,
        color,
        `${input.status} ${statusText(input.status)}`,
      ),
      paint(
        this.#capabilities.color,
        ANSI.gray,
        `${elapsed.toFixed(2)} ms`,
      ),
      input.bytes === undefined
        ? undefined
        : paint(
            this.#capabilities.color,
            ANSI.gray,
            formatBytes(input.bytes),
          ),
      paint(
        this.#capabilities.color,
        ANSI.gray,
        `requestId=${request.requestId}`,
      ),
      input.code === undefined
        ? undefined
        : paint(
            this.#capabilities.color,
            ANSI.red,
            `code=${input.code}`,
          ),
    ]
    .filter(Boolean)
    .join("  ");
    
    this.#emit("response", metadata, [line], input.status >= 500);
  }
  public socket(input: SocketLogInput): void {
    if (this.#options.silent) return;
    const arrows = { connect: "⇄ CONNECT", disconnect: "⇄ DISCONNECT", incoming: "⇢", outgoing: "⇠" } as const;
    const ascii = { connect: "<> CONNECT", disconnect: "<> DISCONNECT", incoming: ">", outgoing: "<" } as const;
    const label = `${this.#capabilities.unicode ? arrows[input.action] : ascii[input.action]}${input.event === undefined ? "" : ` ${input.event}`}`;
    this.#emit("websocket", input, [
      paint(this.#capabilities.color, ANSI.blue, label),
      input.path ?? "",
      paint(this.#capabilities.color, ANSI.gray, [
        `connectionId=${input.connectionId}`,
        input.ip === undefined ? "" : `ip=${input.ip}`,
        input.size === undefined ? "" : `size=${formatBytes(input.size)}`,
        input.duration === undefined ? "" : `duration=${input.duration.toFixed(2)} ms`,
      ].filter(Boolean).join("  ")),
    ].filter((line) => line.length > 0));
  }
  public websocket(input: SocketLogInput): void { this.socket(input); }
  public http(request: RequestHandle, response: ResponseInput): void { this.response(request, response); }
  public diagnostic(input: DiagnosticInput): void {
    if (this.#options.silent && input.severity !== "error" && input.severity !== "fatal") return;
    const location = input.file === undefined ? undefined : `${input.file}${input.line === undefined ? "" : `:${input.line}:${input.column ?? 1}`}`;
    this.#emit("diagnostic", input, [
      `${input.severity.toUpperCase()} ${input.source} ${input.code}`,
      input.message,
      ...(location === undefined ? [] : [location]),
      ...(input.suggestion === undefined ? [] : [`Suggestion: ${input.suggestion}`]),
    ], input.severity === "error" || input.severity === "fatal");
  }
  public runtime(state: "starting" | "stopping" | "restarting" | "reloading" | "ready" | "stopped", metadata?: Readonly<Record<string, unknown>>): void {
    const labels = {
      starting: "Starting Runtime", stopping: "Stopping Runtime", restarting: "Restarting Runtime",
      reloading: "Reloading Runtime", ready: "Runtime Ready", stopped: "Runtime Stopped",
    } as const;
    (state === "ready" ? this.success.bind(this) : this.info.bind(this))(labels[state], { state, ...metadata });
  }
  public compiler(phase: string, status: "started" | "success" | "failure", metadata?: Readonly<Record<string, unknown>>): void {
    const message = status === "started" ? phase : `${phase} ${status === "success" ? "completed" : "failed"}`;
    if (status === "failure") this.error(message, metadata);
    else this.debug(message, metadata);
  }
  public build(input: BuildInput): void {
    const buildId = input.buildId ?? createCorrelationId("build");
    const lines = [
      `Build #${input.build}`,
      input.status === "started" ? "Source changed" : input.status === "success" ? "Build complete" : "Build failed",
      ...(input.changed ?? []),
      ...(input.duration === undefined ? [] : [`${input.duration.toFixed(2)} ms`]),
      `buildId=${buildId}`,
    ];
    this.replaceSection("build", lines, { type: "build", ...input, buildId });
  }
  public watch(paths: readonly string[]): void {
    this.#emit("watch", { paths }, ["Watching", ...paths.map((path) => `${this.#mark("success")} ${path}`)]);
  }
  public clearSection(name = "default"): void {
    const section = this.#sections.get(name);
    if (section === undefined) return;
    if (this.#capabilities.dynamic && section.generation === this.#generation) {
      this.#stdout.write(`${ANSI.cursorUp(section.lines)}${Array.from({ length: section.lines }, () => `${ANSI.clearLine}\n`).join("")}${ANSI.cursorUp(section.lines)}`);
    }
    this.#sections.delete(name);
  }
  public replaceSection(name: string, lines: readonly string[], json: Readonly<Record<string, unknown>> = {}): void {
    this.clearSection(name);
    if (this.#options.silent) return;
    const before = this.#generation;
    this.#emit("section-replace", { name, ...json }, lines);
    this.#sections.set(name, Object.freeze({ lines: lines.length, generation: before + 1 }));
  }

  #level(level: ConsoleLevel, message: string, metadata?: Readonly<Record<string, unknown>>): void {
    if (this.#options.silent && level !== "error") return;
    const colors = { success: ANSI.green, error: ANSI.red, warning: ANSI.yellow, info: ANSI.blue, debug: ANSI.gray, trace: ANSI.gray };
    const marks = { success: this.#mark("success"), error: this.#mark("error"), warning: this.#mark("warning"), info: this.#mark("info"), debug: "·", trace: "·" };
    this.#emit(level, { message, ...metadata }, [paint(this.#capabilities.color, colors[level], `${marks[level]} ${message}`)], level === "error");
  }
  #emit(type: string, value: object, lines: readonly string[], error = false): void {
    if (this.mode === "json") {
      this.#write(`${JSON.stringify({ type, timestamp: new Date().toISOString(), ...value })}\n`, error);
      return;
    }
    this.#write(`${lines.join("\n")}\n`, error);
  }
  #write(value: string, error = false): void {
    this.#generation++;
    (error ? this.#stderr : this.#stdout).write(value);
  }
  #mark(kind: "success" | "error" | "warning" | "info"): string {
    if (!this.#capabilities.unicode) return kind === "success" ? "[OK]" : kind === "error" ? "[X]" : kind === "warning" ? "[!]" : "[i]";
    return kind === "success" ? "✓" : kind === "error" ? "✗" : kind === "warning" ? "!" : "•";
  }
  #symbol(unicode: string, ascii: string): string { return this.#capabilities.unicode ? unicode : ascii; }
}

export const Console = new WarblerConsole();

function center(value: string, width: number): string {
  const left = Math.max(0, Math.floor((width - [...value].length) / 2));
  return `${" ".repeat(left)}${value}`;
}
function duration(value: number | undefined): string | undefined { return value === undefined ? undefined : `${value.toFixed(2)} ms`; }
function round(value: number): number { return Math.round(value * 100) / 100; }
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function statusText(status: number): string {
  const values: Readonly<Record<number, string>> = {
    200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized",
    403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Content Too Large",
    422: "Unprocessable Content", 429: "Too Many Requests", 500: "Internal Server Error", 503: "Service Unavailable",
  };
  return values[status] ?? "";
}
