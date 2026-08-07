import type { CompilerContext } from "@warbler/compiler";
import { compileProject } from "@warbler/compiler";
import { atomicWrite, resolveInside } from "../filesystem";
import { CLIError, describeErrorChain } from "../errors";
import { ExitCode } from "../types";
import { SourceWatcher } from "./source-watcher";
import { DevelopmentViewPipeline } from "./view-pipeline";

/** Managed Runtime handle used by development orchestration. */
export interface DevelopmentRuntimeHandle {
  /** URLs the dev server is reachable at (e.g. `http://localhost:3000`, LAN addresses), when a port-bound transport is enabled. */
  readonly network?: readonly string[];
  stop(): void | Promise<void>;
}
/** Runtime launcher abstraction consumed until Compiler emits executable bindings. */
export interface DevelopmentRuntimeLauncher {
  prepare?(projectRoot: string, overrides?: DevelopmentRuntimeOverrides, report?: DevelopmentReporter): unknown | Promise<unknown>;
  start(projectRoot: string, compiler: CompilerContext, overrides?: DevelopmentRuntimeOverrides, report?: DevelopmentReporter, preparation?: unknown): DevelopmentRuntimeHandle | Promise<DevelopmentRuntimeHandle>;
}
/** Explicit development listener overrides. */
export interface DevelopmentRuntimeOverrides {
  readonly host?: string;
  readonly port?: string;
  readonly mode?: string;
}
/** Structured development progress emitted by orchestration stages. */
export interface DevelopmentEvent {
  readonly stage: "project" | "config" | "compiler" | "bindings" | "runtime" | "transport" | "watcher" | "rebuild" | "reload" | "restart" | "view" | "assets" | "hmr";
  readonly status: "started" | "success" | "failure" | "skipped";
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Non-blocking observer for development progress and rebuild diagnostics. */
export type DevelopmentReporter = (event: DevelopmentEvent) => void;
/** Development session lifecycle state. */
export type DevSessionState = "starting" | "running" | "compiling" | "reloading" | "restarting" | "failed" | "stopping" | "stopped";
/** Typed managed development session. */
export interface DevSession {
  readonly state: DevSessionState;
  readonly projectRoot: string;
  readonly buildNumber: number;
  /** URLs the dev server is reachable at, as last reported by the Runtime launcher. */
  readonly network?: readonly string[] | undefined;
  stop(): Promise<void>;
  wait(): Promise<void>;
}

/** Owns compilation, Runtime launcher, one watcher, reload, restart, and signals. */
export class ManagedDevSession implements DevSession {
  readonly #projectRoot: string;
  readonly #launcher: DevelopmentRuntimeLauncher;
  readonly #watchEnabled: boolean;
  readonly #overrides: DevelopmentRuntimeOverrides;
  readonly #report: DevelopmentReporter;
  readonly #closed = Promise.withResolvers<void>();
  #state: DevSessionState = "starting";
  #runtime: DevelopmentRuntimeHandle | undefined;
  #activeCompiler: CompilerContext | undefined;
  #activePreparation: unknown;
  #watcher: SourceWatcher | undefined;
  #views: DevelopmentViewPipeline | undefined;
  #buildNumber = 0;
  readonly #pendingPaths = new Set<string>();
  #rebuildPromise: Promise<void> | undefined;
  #signalHandler: (() => void) | undefined;
  /** Creates an unstarted development session. */
  public constructor(projectRoot: string, launcher: DevelopmentRuntimeLauncher, watchEnabled: boolean, overrides: DevelopmentRuntimeOverrides = {}, report: DevelopmentReporter = () => {}) {
    this.#projectRoot = projectRoot; this.#launcher = launcher; this.#watchEnabled = watchEnabled; this.#overrides = Object.freeze({ ...overrides }); this.#report = report;
  }
  public get state(): DevSessionState { return this.#state; }
  public get projectRoot(): string { return this.#projectRoot; }
  public get buildNumber(): number { return this.#buildNumber; }
  public get network(): readonly string[] | undefined { return this.#runtime?.network; }
  /** Performs initial compilation and starts the Runtime abstraction. */
  public async start(): Promise<this> {
    const preparation = await this.#launcher.prepare?.(this.#projectRoot, this.#overrides, this.#report);
    this.#views = new DevelopmentViewPipeline(this.#projectRoot, this.#report);
    await this.#views.start();
    const compiler = await this.#compile();
    this.#runtime = await this.#launcher.start(this.#projectRoot, compiler, this.#overrides, this.#report, preparation);
    this.#activeCompiler = compiler;
    this.#activePreparation = preparation;
    this.#emit("runtime", "success", "Runtime is running.");
    if (this.#watchEnabled) {
      this.#emit("watcher", "started", "Starting filesystem watcher.");
      this.#watcher = new SourceWatcher(this.#projectRoot, (paths) => this.notifyChanges(paths));
      this.#watcher.start();
      this.#emit("watcher", "success", "Watching for source changes.");
    } else {
      this.#emit("watcher", "skipped", "Filesystem watching is disabled.");
    }
    this.#installSignals(); this.#state = "running"; return this;
  }
  /** Waits until the managed session stops. */
  public wait(): Promise<void> { return this.#closed.promise; }
  /** Applies one coalesced relevant-change batch; exposed for watcher adapters and deterministic tests. */
  public async notifyChanges(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.#pendingPaths.add(path);
    if (this.#rebuildPromise === undefined) {
      this.#rebuildPromise = this.#drainChanges().finally(() => { this.#rebuildPromise = undefined; });
    }
    await this.#rebuildPromise;
  }
  /** Stops watcher before Runtime and releases signals idempotently. */
  public async stop(): Promise<void> {
    if (this.#state === "stopped" || this.#state === "stopping") return;
    this.#state = "stopping"; this.#watcher?.stop(); this.#removeSignals();
    this.#views?.close();
    await this.#runtime?.stop(); this.#runtime = undefined;
    this.#state = "stopped"; this.#closed.resolve();
  }
  async #compile(): Promise<CompilerContext> {
    this.#emit("compiler", "started", "Compiling application.");
    const compiler = await compileProject(this.#projectRoot);
    const errors = compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error");
    await atomicWrite(this.#projectRoot, ".warbler/diagnostics/compiler.json", `${JSON.stringify(compiler.diagnostics, null, 2)}\n`, true);
    if (errors.length > 0) {
      for (const diagnostic of errors) {
        this.#emit("compiler", "failure", formatCompilerDiagnostic(diagnostic), Object.freeze({
          code: diagnostic.code,
          file: diagnostic.sourceFile,
          line: diagnostic.line,
          column: diagnostic.column,
        }));
      }
      throw new CLIError("CLI2002", `Compilation failed with ${errors.length} error(s).`, ExitCode.FAILURE);
    }
    if (compiler.generatedApplication === undefined || compiler.applicationEntry === undefined || compiler.fingerprint === undefined) {
      throw new CLIError("CLI2003", "Compiler did not emit executable application bindings.", ExitCode.FAILURE);
    }
    this.#buildNumber++;
    this.#emit("compiler", "success", `Application compiled (build ${this.#buildNumber}).`, Object.freeze({ build: this.#buildNumber }));
    this.#emit("bindings", "success", "Executable bindings generated.", Object.freeze({
      entry: compiler.applicationEntry,
      fingerprint: compiler.fingerprint,
    }));
    return compiler;
  }
  async #drainChanges(): Promise<void> {
    while (this.#pendingPaths.size > 0 && this.#state !== "stopping" && this.#state !== "stopped") {
      const paths = Object.freeze([...this.#pendingPaths]);
      this.#pendingPaths.clear();
      await this.#rebuild(paths);
    }
  }
  async #rebuild(paths: readonly string[]): Promise<void> {
    if (this.#state !== "running") return;
    this.#state = "reloading";
    try {
      this.#emit("rebuild", "started", `Change detected in ${paths.length} path(s).`, Object.freeze({ paths }));
      const viewHandled = await this.#views?.rebuild(paths) === true;
      if (viewHandled) {
        this.#emit("rebuild", "success", "View update published without a Runtime restart.");
        return;
      }
      if (paths.every((path) => path.startsWith("public/") || (path.startsWith("resources/") && !path.startsWith("resources/i18n/")))) {
        this.#emit("rebuild", "skipped", "Static or resource change requires no Runtime restart.");
        return;
      }
      const configurationChange = paths.some((path) => path === "package.json" || path === "tsconfig.json" || path.includes("src/config/"));
      const preparation = configurationChange
        ? await this.#launcher.prepare?.(this.#projectRoot, this.#overrides, this.#report)
        : this.#activePreparation;
      this.#state = "compiling";
      const compiler = await this.#compile();
      this.#emit("bindings", "success", "Generated bindings updated on disk.", {
        build: this.#buildNumber,
        fingerprint: compiler.fingerprint,
      });
      this.#state = "restarting";
      const previousBuild = this.#buildNumber - 1;
      this.#emit("restart", "started", `Stopping Runtime #${previousBuild}.`, { build: previousBuild });
      const previousCompiler = this.#activeCompiler;
      const previousPreparation = this.#activePreparation;
      this.#views?.close();
      await this.#runtime?.stop();
      this.#runtime = undefined;
      this.#emit("runtime", "success", `Runtime #${previousBuild} disposed.`, { build: previousBuild });
      try {
        this.#emit("restart", "started", `Creating Runtime #${this.#buildNumber}.`, { build: this.#buildNumber });
        this.#runtime = await this.#launcher.start(this.#projectRoot, compiler, this.#overrides, this.#report, preparation);
        this.#activeCompiler = compiler;
        this.#activePreparation = preparation;
        this.#emit("restart", "success", `Runtime #${this.#buildNumber} ready.`, { build: this.#buildNumber });
      } catch (cause) {
        this.#emit("restart", "failure", "New Runtime failed; restoring the previous valid build.");
        if (previousCompiler !== undefined) {
          this.#runtime = await this.#launcher.start(this.#projectRoot, previousCompiler, this.#overrides, this.#report, previousPreparation);
          this.#activeCompiler = previousCompiler;
          this.#activePreparation = previousPreparation;
          this.#emit("restart", "success", `Previous Runtime #${previousBuild} restored.`, { build: previousBuild });
        }
        throw cause;
      }
    } catch (cause) {
      this.#emit("rebuild", "failure", describeErrorChain(cause, "Unknown development failure."));
    } finally {
      if (!this.#isStopping()) {
        this.#state = "running";
        if (this.#watchEnabled) this.#emit("watcher", "success", "Watching for source changes.");
      }
    }
  }
  #installSignals(): void {
    this.#signalHandler = (): void => { void this.stop(); };
    process.on("SIGINT", this.#signalHandler); process.on("SIGTERM", this.#signalHandler);
  }
  #removeSignals(): void {
    if (this.#signalHandler === undefined) return;
    process.off("SIGINT", this.#signalHandler); process.off("SIGTERM", this.#signalHandler); this.#signalHandler = undefined;
  }
  #isStopping(): boolean { return this.#state === "stopping" || this.#state === "stopped"; }
  #emit(stage: DevelopmentEvent["stage"], status: DevelopmentEvent["status"], message: string, metadata?: Readonly<Record<string, unknown>>): void {
    this.#report(Object.freeze({ stage, status, message, ...(metadata === undefined ? {} : { metadata }) }));
  }
}
function formatCompilerDiagnostic(diagnostic: CompilerContext["diagnostics"][number]): string {
  const location = diagnostic.sourceFile.length === 0 ? "" : `${diagnostic.sourceFile}:${diagnostic.line}:${diagnostic.column} `;
  return `${location}${diagnostic.code} ${diagnostic.message}`;
}
