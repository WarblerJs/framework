import type { AbstractConstructor, Constructor } from "../types";

/** Represents a dependency-injection token. */
export type ProviderToken<T> = Constructor<T> | AbstractConstructor<T> | InjectionToken<T> | string | symbol;

/** Represents a typed non-class dependency-injection token. */
export interface InjectionToken<T> {
  readonly id: symbol;
  readonly description: string;
  readonly __type?: T;
}

/** Creates a typed non-class dependency-injection token. */
export function createToken<T>(description: string): InjectionToken<T> {
  return Object.freeze({ id: Symbol(description), description });
}

/** @deprecated Use {@link createToken}. */
export const createInjectionToken = createToken;

/** Returns a human-readable provider-token name. */
export function tokenName<T>(token: ProviderToken<T>): string {
  if (typeof token === "function") return token.name || "AnonymousProvider";
  if (typeof token === "string") return token;
  if (typeof token === "symbol") return token.description ?? token.toString();
  return token.description;
}
