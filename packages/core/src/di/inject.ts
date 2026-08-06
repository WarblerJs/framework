import { getActiveContainer } from "./injection-context";
import type { AbstractConstructor, Constructor } from "../types";
import type { InjectionToken, ProviderToken } from "./token";

/** Resolves a dependency from the active Warbler injection context. */
export function inject<T>(token: Constructor<T> | AbstractConstructor<T> | InjectionToken<T>): T;
export function inject<T = unknown>(token: string | symbol): T;
export function inject<T>(token: ProviderToken<T>): T {
  return getActiveContainer().resolve(token);
}

/** Resolves an optional dependency from the active Warbler injection context. */
export function injectOptional<T>(token: Constructor<T> | AbstractConstructor<T> | InjectionToken<T>): T | undefined;
export function injectOptional<T = unknown>(token: string | symbol): T | undefined;
export function injectOptional<T>(token: ProviderToken<T>): T | undefined {
  return getActiveContainer().resolveOptional(token);
}
