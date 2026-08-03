import type { Constructor } from "../types";

/** Represents a dependency-injection token. */
export type ProviderToken<T> = Constructor<T> | InjectionToken<T>;

/** Represents a typed non-class dependency-injection token. */
export interface InjectionToken<T> {
  readonly id: symbol;
  readonly description: string;
  readonly __type?: T;
}

/** Creates a typed non-class dependency-injection token. */
export function createInjectionToken<T>(description: string): InjectionToken<T> {
  return Object.freeze({ id: Symbol(description), description });
}

/** Returns a human-readable provider-token name. */
export function tokenName<T>(token: ProviderToken<T>): string {
  return typeof token === "function" ? token.name || "AnonymousProvider" : token.description;
}
