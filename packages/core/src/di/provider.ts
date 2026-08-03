import type { ProviderToken } from "./token";
import type { Constructor } from "../types";

/** Provider lifecycle scopes supported by the core container. */
export type ProviderScope = "singleton" | "transient";

/** Defines a class provider. */
export interface ClassProvider<T> {
  readonly token: ProviderToken<T>;
  readonly useClass: Constructor<T>;
  readonly scope?: ProviderScope;
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
  readonly scope?: ProviderScope;
}

/** A supported dependency-injection provider definition. */
export type Provider<T = unknown> = Constructor<T> | ClassProvider<T> | ValueProvider<T> | FactoryProvider<T>;
