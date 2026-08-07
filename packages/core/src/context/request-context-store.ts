/** Thrown when `context.set(...)` is called after the request context has been frozen. */
export class RequestContextFrozenError extends Error {
  public constructor(key: string) {
    super(
      `context.set("${key}") was called after the request context was frozen. ` +
      "Guards and middleware may only set context values before the controller handler runs.",
    );
    this.name = "RequestContextFrozenError";
  }
}

/** The `.set`/`.get` surface guards and middleware receive as their second argument. */
export interface RequestContextHandle {
  get(key: string): unknown;
  set<T>(key: string, value: T | (() => T | Promise<T>)): void;
}

/**
 * Per-request context store threaded through guards, middleware, and the controller
 * handler. Backed by a plain null-prototype object (not a `Map`) so reads and writes
 * are direct property operations — no hashing, no per-access allocation.
 *
 * Mutable while guards/middleware run. `settle()` awaits any pending async factories
 * and freezes the store; the runtime calls it once, right before the controller
 * handler executes, so `AppRequest.context` is always readonly by the time a
 * controller sees it.
 *
 * A value set via an async factory is only guaranteed visible to `.get()` after
 * `settle()` resolves — a later guard/middleware reading the same key before that
 * factory's promise settles will see `undefined`.
 *
 * Lives in `@warbler/core` (not `@warbler/http`) so it's usable from `@warbler/runtime`
 * without giving the runtime a dependency on the HTTP package — `@warbler/http`
 * re-exports it as part of its own public surface.
 */
export class RequestContextStore implements RequestContextHandle {
  #values: Record<string, unknown> = Object.create(null);
  #pending: Map<string, Promise<unknown>> | undefined;
  #frozen = false;

  public set<T>(key: string, value: T | (() => T | Promise<T>)): void {
    if (this.#frozen) throw new RequestContextFrozenError(key);
    if (typeof value !== "function") {
      this.#values[key] = value;
      return;
    }
    const produced = (value as () => T | Promise<T>)();
    if (isThenable(produced)) {
      const settled = produced.then((resolved) => { this.#values[key] = resolved; });
      (this.#pending ??= new Map()).set(key, settled);
      return;
    }
    this.#values[key] = produced;
  }

  public get(key: string): unknown {
    return this.#values[key];
  }

  /** The live, still-mutable values — used as `AppRequest.context` before `settle()` runs. */
  public currentView(): Readonly<Record<string, unknown>> {
    return this.#values;
  }

  /**
   * Awaits any pending async factories, then freezes the store. Not declared
   * `async`: when nothing is pending (the common case) this returns synchronously,
   * matching the guard/validator execution's existing sync-fast-path convention
   * rather than forcing a microtask tick on every request.
   */
  public settle(): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>> {
    if (this.#pending === undefined) {
      this.#frozen = true;
      return Object.freeze(this.#values);
    }
    return this.#settleAsync();
  }

  async #settleAsync(): Promise<Readonly<Record<string, unknown>>> {
    await Promise.all(this.#pending!.values());
    this.#pending = undefined;
    this.#frozen = true;
    return Object.freeze(this.#values);
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof (value as { then: unknown }).then === "function";
}
