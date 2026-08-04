import type { CompilerContext } from "@warbler/compiler";
import { compileProject } from "@warbler/compiler";
import { mkdir } from "node:fs/promises";
import { atomicWrite, resolveInside } from "../filesystem";
import { CLIError } from "../errors";
import { ExitCode } from "../types";
import { SourceWatcher } from "./source-watcher";

/** Managed Runtime handle used by development orchestration. */
export interface DevelopmentRuntimeHandle {
  stop(): void | Promise<void>;
  reload?(compiler: CompilerContext): boolean | Promise<boolean>;
}
/** Runtime launcher abstraction consumed until Compiler emits executable bindings. */
export interface DevelopmentRuntimeLauncher {
  start(projectRoot: string, compiler: CompilerContext, overrides?: DevelopmentRuntimeOverrides): DevelopmentRuntimeHandle | Promise<DevelopmentRuntimeHandle>;
}
/** Explicit development listener overrides. */
export interface DevelopmentRuntimeOverrides {
  readonly host?: string;
  readonly port?: string;
  readonly mode?: string;
}
/** Development session lifecycle state. */
export type DevSessionState = "starting" | "running" | "reloading" | "stopping" | "stopped";
/** Typed managed development session. */
export interface DevSession {
  readonly state: DevSessionState;
  stop(): Promise<void>;
  wait(): Promise<void>;
}

/** Owns compilation, Runtime launcher, one watcher, reload, restart, and signals. */
export class ManagedDevSession implements DevSession {
  readonly #projectRoot: string;
  readonly #launcher: DevelopmentRuntimeLauncher;
  readonly #watchEnabled: boolean;
  readonly #overrides: DevelopmentRuntimeOverrides;
  readonly #closed = Promise.withResolvers<void>();
  #state: DevSessionState = "starting";
  #runtime: DevelopmentRuntimeHandle | undefined;
  #watcher: SourceWatcher | undefined;
  #artifactSignature = "";
  #signalHandler: (() => void) | undefined;
  /** Creates an unstarted development session. */
  public constructor(projectRoot: string, launcher: DevelopmentRuntimeLauncher, watchEnabled: boolean, overrides: DevelopmentRuntimeOverrides = {}) {
    this.#projectRoot = projectRoot; this.#launcher = launcher; this.#watchEnabled = watchEnabled; this.#overrides = Object.freeze({ ...overrides });
  }
  public get state(): DevSessionState { return this.#state; }
  /** Performs initial compilation and starts the Runtime abstraction. */
  public async start(): Promise<this> {
    const compiler = await this.#compile();
    this.#runtime = await this.#launcher.start(this.#projectRoot, compiler, this.#overrides);
    if (this.#watchEnabled) {
      this.#watcher = new SourceWatcher(this.#projectRoot, (paths) => this.notifyChanges(paths));
      this.#watcher.start();
    }
    this.#installSignals(); this.#state = "running"; return this;
  }
  /** Waits until the managed session stops. */
  public wait(): Promise<void> { return this.#closed.promise; }
  /** Applies one coalesced relevant-change batch; exposed for watcher adapters and deterministic tests. */
  public async notifyChanges(paths: readonly string[]): Promise<void> {
    await this.#rebuild(paths);
  }
  /** Stops watcher before Runtime and releases signals idempotently. */
  public async stop(): Promise<void> {
    if (this.#state === "stopped" || this.#state === "stopping") return;
    this.#state = "stopping"; this.#watcher?.stop(); this.#removeSignals();
    await this.#runtime?.stop(); this.#runtime = undefined;
    this.#state = "stopped"; this.#closed.resolve();
  }
  async #compile(): Promise<CompilerContext> {
    const compiler = await compileProject(this.#projectRoot);
    const errors = compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error");
    await mkdir(resolveInside(this.#projectRoot, ".warbler/diagnostics"), { recursive: true });
    await atomicWrite(this.#projectRoot, ".warbler/diagnostics/compiler.json", `${JSON.stringify(compiler.diagnostics, null, 2)}\n`, true);
    if (errors.length > 0) throw new CLIError("CLI2101", `Compilation failed with ${errors.length} error(s).`, ExitCode.FAILURE);
    const files = compiler.generatedApplication?.files ?? {};
    for (const [name, content] of Object.entries(files)) await atomicWrite(this.#projectRoot, `.warbler/generated/${name}`, content, true);
    this.#artifactSignature = JSON.stringify(files);
    return compiler;
  }
  async #rebuild(paths: readonly string[]): Promise<void> {
    if (this.#state !== "running") return;
    this.#state = "reloading";
    try {
      if (paths.every((path) => path.startsWith("public/") || path.startsWith("resources/"))) return;
      const previous = this.#artifactSignature;
      const configurationChange = paths.some((path) => path === "package.json" || path === "tsconfig.json" || path.includes("src/config/"));
      const compiler = await this.#compile();
      if (this.#artifactSignature === previous && !configurationChange) return;
      const reloaded = !configurationChange && this.#runtime?.reload !== undefined && await this.#runtime.reload(compiler);
      if (!reloaded) {
        await this.#runtime?.stop();
        this.#runtime = await this.#launcher.start(this.#projectRoot, compiler, this.#overrides);
      }
    } catch {
      // Compiler diagnostics were persisted; keep the last valid Runtime running.
    } finally { if (this.#state === "reloading") this.#state = "running"; }
  }
  #installSignals(): void {
    this.#signalHandler = (): void => { void this.stop(); };
    process.on("SIGINT", this.#signalHandler); process.on("SIGTERM", this.#signalHandler);
  }
  #removeSignals(): void {
    if (this.#signalHandler === undefined) return;
    process.off("SIGINT", this.#signalHandler); process.off("SIGTERM", this.#signalHandler); this.#signalHandler = undefined;
  }
}
