import { getActiveContainer } from "./injection-context";
import type { ProviderToken } from "./token";

/** Resolves a dependency from the active Warbler injection context. */
export function inject<T>(token: ProviderToken<T>): T {
  return getActiveContainer().resolve(token);
}

/** Resolves an optional dependency from the active Warbler injection context. */
export function injectOptional<T>(token: ProviderToken<T>): T | undefined {
  return getActiveContainer().resolveOptional(token);
}
