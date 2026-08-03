/** Represents a constructable class token. */
export type Constructor<T = object> = new (...args: never[]) => T;
