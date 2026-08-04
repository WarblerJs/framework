/** Generated provider factory called with compiler-ordered dependencies. */
export type RuntimeProviderFactory = (dependencies: readonly unknown[]) => unknown;
/** Explicit provider disposer; Runtime performs no lifecycle-method reflection. */
export type RuntimeProviderDisposer = (instance: unknown) => void | Promise<void>;
