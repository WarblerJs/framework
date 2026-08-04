export type ConsoleMode = "human" | "json";
export type ConsoleLevel = "success" | "error" | "warning" | "info" | "debug" | "trace";
export interface ConsoleWriter {
  readonly isTTY?: boolean;
  write(value: string): unknown;
}
export interface ConsoleOptions {
  readonly mode?: ConsoleMode;
  readonly color?: boolean;
  readonly unicode?: boolean;
  readonly silent?: boolean;
  readonly verbose?: boolean;
  readonly stdout?: ConsoleWriter;
  readonly stderr?: ConsoleWriter;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}
export interface DiagnosticInput {
  readonly source: "compiler" | "runtime" | "http" | "websocket" | "cli";
  readonly code: string;
  readonly severity: "info" | "warning" | "error" | "fatal";
  readonly message: string;
  readonly suggestion?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}
export interface RequestStartInput {
  readonly method: string;
  readonly path: string;
  readonly requestId?: string;
}
export interface RequestHandle {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
}
export interface ResponseInput {
  readonly status: number;
  readonly bytes?: number;
  readonly code?: string;
}
export interface SocketLogInput {
  readonly action: "connect" | "disconnect" | "incoming" | "outgoing";
  readonly event?: string;
  readonly path?: string;
  readonly connectionId: string;
  readonly ip?: string;
  readonly size?: number;
  readonly duration?: number;
}
export interface BannerInput {
  readonly title?: string;
  readonly subtitle?: string;
  readonly version: string;
  readonly bunVersion?: string;
  readonly project: string;
  readonly build?: number;
  readonly compilerMs?: number;
  readonly runtimeMs?: number;
  readonly http?: string;
  readonly websocket?: string;
  readonly watching?: readonly string[];
}
export interface BuildInput {
  readonly build: number;
  readonly buildId?: string;
  readonly changed?: readonly string[];
  readonly duration?: number;
  readonly status: "started" | "success" | "failure";
}
export interface TableInput {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}
export interface Timer {
  readonly id: string;
  readonly startedAt: number;
  elapsed(): number;
  end(metadata?: Readonly<Record<string, unknown>>): number;
}
