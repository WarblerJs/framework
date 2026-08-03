import type { BunRouteTable } from "../native";
import { ServerStateError } from "../errors";

/** Minimal native reload handle used by development route orchestration. */
export interface ReloadableHttpServer {
  reload(options: Readonly<{ routes: BunRouteTable }>): unknown;
}

/** Coalesces rapid development changes and reloads only materially changed route tables. */
export class HttpDevReloader {
  readonly #server: ReloadableHttpServer;
  readonly #compile: () => BunRouteTable | Promise<BunRouteTable>;
  readonly #delayMs: number;
  #current: BunRouteTable;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** Creates a development-only debounced route reloader. */
  public constructor(
    server: ReloadableHttpServer,
    initial: BunRouteTable,
    compile: () => BunRouteTable | Promise<BunRouteTable>,
    delayMs = 20,
  ) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new ServerStateError("Reload delay must be a non-negative safe integer");
    this.#server = server;
    this.#current = initial;
    this.#compile = compile;
    this.#delayMs = delayMs;
  }

  /** Schedules one compile/reload cycle for a burst of source changes. */
  public schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.#flush(); }, this.#delayMs);
  }

  /** Cancels a pending development reload. */
  public cancel(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #flush(): Promise<void> {
    this.#timer = undefined;
    const next = await this.#compile();
    if (Bun.deepEquals(this.#current, next)) return;
    this.#current = next;
    this.#server.reload({ routes: next });
  }
}
