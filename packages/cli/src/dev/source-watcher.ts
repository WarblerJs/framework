import { watch, type FSWatcher } from "node:fs";

const IGNORED = /(?:^|[/\\])(?:node_modules|public|dist|\.warbler|\.git|coverage)(?:[/\\]|$)/u;
const RELEVANT = /\.(?:[cm]?[jt]sx?|html?|css|scss|sass)$/iu;
const PROJECT_FILE = /^(?:package\.json|tsconfig\.json)$/u;

/** One recursive project watcher with one shared burst-coalescing timer. */
export class SourceWatcher {
  readonly #root: string;
  readonly #onChange: (paths: readonly string[]) => void | Promise<void>;
  readonly #pending = new Set<string>();
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Creates an unstarted source watcher. */
  public constructor(root: string, onChange: (paths: readonly string[]) => void | Promise<void>) {
    this.#root = root; this.#onChange = onChange;
  }
  /** Starts the single project watcher. */
  public start(): void {
    if (this.#watcher !== undefined) return;
    this.#watcher = watch(this.#root, { recursive: true }, (_event, filename) => {
      if (filename === null) return;
      const path = filename.toString();
      if (!isRelevantSourcePath(path)) return;
      this.#pending.add(path);
      if (this.#timer !== undefined) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { void this.#flush(); }, 40);
    });
  }
  /** Stops watcher and coalescing state. */
  public stop(): void {
    this.#watcher?.close(); this.#watcher = undefined;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined; this.#pending.clear();
  }
  async #flush(): Promise<void> {
    this.#timer = undefined;
    const paths = Object.freeze([...this.#pending].sort());
    this.#pending.clear();
    await this.#onChange(paths);
  }
}
/** Returns whether a path is relevant to development recompilation. */
export function isRelevantSourcePath(path: string): boolean {
  return !IGNORED.test(path) && (RELEVANT.test(path) || PROJECT_FILE.test(path));
}
