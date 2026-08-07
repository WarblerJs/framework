import type { ProviderToken } from "./token";

/** Minimal contract for anything that can serve as the active Warbler injection context. */
export interface InjectionResolver {
  resolve<T>(token: ProviderToken<T>): T;
  resolveOptional<T>(token: ProviderToken<T>): T | undefined;
}
