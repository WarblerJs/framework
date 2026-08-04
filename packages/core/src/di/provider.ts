import type { ProviderToken } from "./token";
import type { Constructor } from "../types";

/** Provider instance lifetimes supported by the core container. */
export type ProviderLifetime = "singleton" | "transient";

/** Provider visibility scopes understood by Graph compilation. */
export const ProviderScope = Object.freeze({
  GRAPH: "graph",
  ROOT: "root",
} as const);

/** Provider visibility across Graph boundaries. */
export type ProviderScope = (typeof ProviderScope)[keyof typeof ProviderScope];

/** Visibility options accepted by injectable decorators. */
export interface ProviderOptions {
  readonly provide?: ProviderScope;
}

/** Defines a class provider. */
export interface ClassProvider<T> {
  readonly token: ProviderToken<T>;
  readonly useClass: Constructor<T>;
  readonly scope?: ProviderLifetime;
}

/** Defines a value provider. */
export interface ValueProvider<T> {
  readonly token: ProviderToken<T>;
  readonly useValue: T;
}

/** Defines a factory provider. */
export interface FactoryProvider<T> {
  readonly token: ProviderToken<T>;
  readonly useFactory: () => T;
  readonly scope?: ProviderLifetime;
}

/** A supported dependency-injection provider definition. */
export type Provider<T = unknown> = Constructor<T> | ClassProvider<T> | ValueProvider<T> | FactoryProvider<T>;
