/** Represents a value that may be available immediately or through a native Promise. */
export type MaybePromise<T> = T | Promise<T>;
