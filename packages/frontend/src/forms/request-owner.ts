/** Owns active fetch identity so stale completions cannot mutate a newer lifecycle. */
export class SubmissionRequestOwner {
  #current: AbortController | undefined;
  #destroyed = false;

  public begin(): AbortController {
    if (this.#destroyed) throw new Error("Form request owner has been destroyed.");
    this.#current?.abort();
    const controller = new AbortController();
    this.#current = controller;
    return controller;
  }
  public owns(controller: AbortController): boolean {
    return !this.#destroyed && this.#current === controller;
  }
  public finish(controller: AbortController): boolean {
    if (!this.owns(controller)) return false;
    this.#current = undefined;
    return true;
  }
  public destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#current?.abort();
    this.#current = undefined;
  }
}

export function isIntentionalAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
