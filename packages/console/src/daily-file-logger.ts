import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/** Runtime configuration for Warbler's buffered daily error-file logger. */
export interface DailyFileLoggerConfig {
  /** Enables interval flushing when `true`; disabled loggers can still be flushed manually in tests. */
  readonly enabled: boolean;
  /** Absolute or workspace-resolved directory where `warbler-YYYY-MM-DD.log` files are written. */
  readonly directory: string;
  /** Number of daily log files to retain. `0` disables cleanup. */
  readonly retentionDays: number;
  /** Background flush cadence in milliseconds. Defaults to a short nonblocking interval. */
  readonly flushIntervalMs?: number;
  /** Maximum in-memory entries retained before older entries are dropped. */
  readonly maxBufferEntries?: number;
  /** Number of log filenames processed before yielding during cleanup. */
  readonly cleanupBatchSize?: number;
  /** Clock override used by tests and deterministic build/runtime checks. */
  readonly now?: () => Date;
}

/** Request or connection metadata attached to one error log entry. */
export interface ErrorLogRequestContext {
  /** HTTP method, when the failing transport has one. */
  readonly method?: string;
  /** Request path or URL path. */
  readonly path?: string;
  /** Resolved route pattern, when known. */
  readonly route?: string;
  /** Handler/controller identifier, when known. */
  readonly handler?: string;
  /** Trusted client IP after proxy policy has been applied. */
  readonly clientIp?: string;
  /** Correlation ID for the request, connection, or process failure. */
  readonly requestId?: string;
  /** Transport name such as `HTTP`, `WebSocket`, `SSE`, or `process`. */
  readonly transport?: string;
}

/** Fully normalized log payload emitted by transport error presenters. */
export interface ErrorLogEntry {
  /** Time the failure was observed. */
  readonly timestamp: Date;
  /** File log severity label. */
  readonly level: "ERROR" | "FATAL";
  /** Stable machine-readable Warbler error code. */
  readonly code: string;
  /** HTTP-equivalent status code used for transport-neutral triage. */
  readonly status: number;
  /** Safe public message. */
  readonly message: string;
  /** Internal diagnostic message written only to trusted logs. */
  readonly developerMessage?: string;
  /** Stack trace after production redaction. */
  readonly stack?: string;
  /** Original cause retained for internal diagnostics. */
  readonly cause?: unknown;
  /** Optional request or connection metadata. */
  readonly request?: ErrorLogRequestContext;
}

interface QueuedLogEntry {
  readonly dateKey: string;
  readonly text: string;
}

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_BUFFER_ENTRIES = 256;
const DEFAULT_CLEANUP_BATCH_SIZE = 32;
const DIVIDER = "- " + "•".repeat(56);
const LOG_FILE_PATTERN = /^warbler-(\d{4}-\d{2}-\d{2})\.log$/u;
const SECRET_PATTERNS = Object.freeze([
  /(authorization:\s*)(bearer\s+)?[^\s\r\n]+/giu,
  /((?:password|passwd|token|secret|cookie|api[_-]?key)\s*[=:]\s*)[^\s&\r\n]+/giu,
  /postgres:\/\/[^\s\r\n]+/giu,
  /mysql:\/\/[^\s\r\n]+/giu,
  /mongodb(?:\+srv)?:\/\/[^\s\r\n]+/giu,
]);

/** Bounded, async, daily rotating file logger for error-path-only reports. */
export class BufferedDailyFileLogger {
  readonly #directory: string;
  readonly #retentionDays: number;
  readonly #maxBufferEntries: number;
  readonly #cleanupBatchSize: number;
  readonly #now: () => Date;
  readonly #queue: QueuedLogEntry[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #flushing = false;
  #flushAgain = false;
  #lastCleanupDate = "";

  public constructor(config: DailyFileLoggerConfig) {
    this.#directory = resolve(config.directory);
    this.#retentionDays = Math.max(0, Math.floor(config.retentionDays));
    this.#maxBufferEntries = Math.max(1, Math.floor(config.maxBufferEntries ?? DEFAULT_MAX_BUFFER_ENTRIES));
    this.#cleanupBatchSize = Math.max(1, Math.floor(config.cleanupBatchSize ?? DEFAULT_CLEANUP_BATCH_SIZE));
    this.#now = config.now ?? (() => new Date());
    const interval = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    if (config.enabled && interval > 0) {
      this.#timer = setInterval(() => { void this.flush(); }, interval);
      this.#timer.unref?.();
    }
  }

  /** Adds one preformatted entry to the in-memory queue and schedules an async flush. */
  public enqueue(entry: ErrorLogEntry): void {
    const dateKey = dateSegment(entry.timestamp);
    if (this.#queue.length >= this.#maxBufferEntries) this.#queue.shift();
    this.#queue.push(Object.freeze({ dateKey, text: formatDailyLogEntry(entry) }));
    if (this.#queue.length >= this.#maxBufferEntries) void this.flush();
  }

  /** Flushes queued entries grouped by day. Safe to call concurrently. */
  public async flush(): Promise<void> {
    if (this.#flushing) {
      this.#flushAgain = true;
      return;
    }
    this.#flushing = true;
    try {
      do {
        this.#flushAgain = false;
        const entries = this.#queue.splice(0, this.#queue.length);
        if (entries.length === 0) continue;
        await mkdir(this.#directory, { recursive: true });
        let currentDate = "";
        let text = "";
        for (const entry of entries) {
          if (currentDate.length === 0) currentDate = entry.dateKey;
          if (entry.dateKey !== currentDate) {
            await appendFile(this.#pathFor(currentDate), text);
            await this.#cleanupOnce(currentDate);
            currentDate = entry.dateKey;
            text = "";
          }
          text += entry.text;
        }
        if (currentDate.length > 0 && text.length > 0) {
          await appendFile(this.#pathFor(currentDate), text);
          await this.#cleanupOnce(currentDate);
        }
      } while (this.#flushAgain);
    } finally {
      this.#flushing = false;
    }
  }

  /** Stops interval flushing and writes the remaining buffer. */
  public async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.flush();
  }

  #pathFor(dateKey: string): string {
    return join(this.#directory, `warbler-${dateKey}.log`);
  }

  async #cleanupOnce(currentDate: string): Promise<void> {
    if (this.#retentionDays <= 0 || this.#lastCleanupDate === currentDate) return;
    this.#lastCleanupDate = currentDate;
    await cleanupExpiredLogs(this.#directory, this.#retentionDays, this.#now(), this.#cleanupBatchSize);
  }
}

/** Formats one human-readable log entry. Exported for focused tests. */
export function formatDailyLogEntry(entry: ErrorLogEntry): string {
  const request = entry.request;
  const lines = [
    `[${formatTimestamp(entry.timestamp)}] ${entry.level}`,
    "",
    `Code:       ${sanitizeLogValue(entry.code)}`,
    `Status:     ${entry.status}`,
    request?.method === undefined && request?.path === undefined ? undefined : `Request:    ${request.method ?? "-"} ${request.path ?? "-"}`,
    request?.clientIp === undefined ? undefined : `IP:         ${sanitizeLogValue(request.clientIp)}`,
    request?.handler === undefined ? undefined : `Handler:    ${sanitizeLogValue(request.handler)}`,
    request?.requestId === undefined ? undefined : `Request ID: ${sanitizeLogValue(request.requestId)}`,
    request?.transport === undefined ? undefined : `Transport:  ${sanitizeLogValue(request.transport)}`,
    "",
    sanitizeLogValue(entry.developerMessage ?? entry.message),
  ];
  if (entry.stack !== undefined) {
    for (const line of sanitizeLogValue(entry.stack).split("\n")) lines.push(line);
  }
  lines.push("", DIVIDER, "", "");
  let output = "";
  for (const line of lines) if (line !== undefined) output += `${line}\n`;
  return output;
}

/** Removes expired `warbler-YYYY-MM-DD.log` files in small yielding batches. */
export async function cleanupExpiredLogs(directory: string, retentionDays: number, now: Date, batchSize = DEFAULT_CLEANUP_BATCH_SIZE): Promise<void> {
  let names: string[];
  try { names = await readdir(directory); } catch { return; }
  const cutoff = startOfUtcDay(now).getTime() - retentionDays * 86_400_000;
  let processed = 0;
  for (const name of names) {
    const match = LOG_FILE_PATTERN.exec(basename(name));
    if (match === null) continue;
    const time = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isFinite(time) && time < cutoff) {
      try { await unlink(join(directory, name)); } catch {}
    }
    processed++;
    if (processed % batchSize === 0) await Bun.sleep(0);
  }
}

/** Removes control characters and redacts common secret-bearing values before disk writes. */
export function sanitizeLogValue(value: string): string {
  let output = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (_match: string, prefix: unknown) => `${typeof prefix === "string" ? prefix : ""}[REDACTED]`);
  }
  return output;
}

function dateSegment(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
