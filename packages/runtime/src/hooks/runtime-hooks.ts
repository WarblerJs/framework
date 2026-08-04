/** Runtime hook callback. */
export type RuntimeHook = () => void | Promise<void>;
/** Application lifecycle hooks executed in registration order. */
export interface RuntimeHooks {
  readonly onRuntimeStart?: readonly RuntimeHook[];
  readonly onRuntimeReady?: readonly RuntimeHook[];
  readonly onRuntimeShutdown?: readonly RuntimeHook[];
}

/** Runs hooks in stable order without allocating wrapper promises for synchronous callbacks. */
export async function executeRuntimeHooks(hooks: readonly RuntimeHook[] = []): Promise<void> {
  for (const hook of hooks) {
    const result = hook();
    if (result instanceof Promise) await result;
  }
}
