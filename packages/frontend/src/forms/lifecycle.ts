/** Small deterministic cleanup owner. Cleanup continues even if one callback fails. */
export class CleanupRegistry {
  readonly #cleanups: Array<() => void> = [];
  #destroyed = false;

  public get destroyed(): boolean { return this.#destroyed; }

  public add(cleanup: () => void): void {
    if (this.#destroyed) { safely(cleanup); return; }
    this.#cleanups.push(once(cleanup));
  }

  public destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const cleanup of this.#cleanups.splice(0).reverse()) safely(cleanup);
  }
}

interface Destroyable { destroy(): void }

/** Weak DOM ownership used for HMR-safe replacement without retaining detached elements. */
export class InstanceRegistry<TElement extends object, TInstance extends Destroyable> {
  readonly #instances = new WeakMap<TElement, TInstance>();
  public replace(element: TElement, create: () => TInstance): TInstance {
    this.#instances.get(element)?.destroy();
    const instance = create();
    this.#instances.set(element, instance);
    return instance;
  }
  public release(element: TElement, instance: TInstance): void {
    if (this.#instances.get(element) === instance) this.#instances.delete(element);
  }
  public get(element: TElement): TInstance | undefined { return this.#instances.get(element); }
}

export function once(cleanup: () => void): () => void {
  let active = true;
  return () => { if (!active) return; active = false; cleanup(); };
}
function safely(cleanup: () => void): void { try { cleanup(); } catch { /* continue cleanup */ } }
