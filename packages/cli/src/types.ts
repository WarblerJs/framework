/** Supported CLI command names. */
export type CLICommandName = "dev" | "build" | "start" | "doctor" | "inspect" | "new" | "make:graph" | "generate" | "db:pg" | "clean" | "version" | "help";
/** Parsed flag value. */
export type CLIFlagValue = string | boolean;
/** Deterministic parser result. */
export interface ParsedCLI {
  readonly command: CLICommandName;
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, CLIFlagValue>>;
}
/** Immutable command execution context. */
export interface CLIContext extends ParsedCLI {
  readonly cwd: string;
  readonly projectRoot?: string;
  readonly format: "human" | "json";
  readonly verbose: boolean;
}
/** Stable CLI exit codes. */
export const ExitCode = Object.freeze({
  SUCCESS: 0, FAILURE: 1, INVALID_ARGUMENTS: 2, INVALID_PROJECT: 3,
  MISSING_DEPENDENCY: 4, RUNTIME_FAILURE: 5, FILESYSTEM_FAILURE: 6, PROCESS_FAILURE: 7,
} as const);
/** Stable CLI exit code. */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
