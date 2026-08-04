import { CLIError } from "../errors";
import { ExitCode } from "../types";

/** Owns one Bun child process and forwards termination signals exactly once. */
export class ProcessOwner {
  #child: Bun.Subprocess<"inherit", "inherit", "inherit"> | undefined;
  #signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  /** Starts a managed process from an argument array, never a shell string. */
  public start(command: readonly string[], cwd: string): void {
    if (this.#child !== undefined) throw new CLIError("CLI7001", "Child process is already running.", ExitCode.PROCESS_FAILURE);
    this.#child = Bun.spawn([...command], { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    this.#signalHandler = (signal): void => { this.#child?.kill(signal); };
    process.on("SIGINT", this.#signalHandler);
    process.on("SIGTERM", this.#signalHandler);
  }
  /** Waits for the managed child and returns its exit code. */
  public async wait(): Promise<number> {
    if (this.#child === undefined) throw new CLIError("CLI7002", "Child process has not started.", ExitCode.PROCESS_FAILURE);
    try { return await this.#child.exited; }
    finally { this.#cleanup(); this.#child = undefined; }
  }
  /** Terminates the child and releases signal listeners. */
  public stop(signal: NodeJS.Signals = "SIGTERM"): void {
    this.#child?.kill(signal); this.#cleanup();
  }
  #cleanup(): void {
    if (this.#signalHandler === undefined) return;
    process.off("SIGINT", this.#signalHandler); process.off("SIGTERM", this.#signalHandler);
    this.#signalHandler = undefined;
  }
}
