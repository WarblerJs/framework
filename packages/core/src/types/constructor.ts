/** Represents a constructable class token. */
export type Constructor<T = object> = new (...args: never[]) => T;

/** Represents an abstract class token, usable for typed interface-style injection. */
export type AbstractConstructor<T = object> = abstract new (...args: never[]) => T;
