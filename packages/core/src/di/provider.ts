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
  /** A Graph/Root visibility scope, or a token this provider should also be registered under. */
  readonly provide?: ProviderScope | ProviderToken<unknown>;
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

/** Defines a provider that aliases an already-registered token. */
export interface ExistingProvider<T> {
  readonly token: ProviderToken<T>;
  readonly useExisting: ProviderToken<T>;
}

/** A supported dependency-injection provider definition. */
export type Provider<T = unknown> = Constructor<T> | ClassProvider<T> | ValueProvider<T> | FactoryProvider<T> | ExistingProvider<T>;

/** A `Provider()`-call definition, spelling the token as `provide:` to mirror decorator options. */
export type ProviderDefinition<T = unknown> =
  | Constructor<T>
  | { readonly provide: ProviderToken<T>; readonly useClass: Constructor<T>; readonly scope?: ProviderLifetime }
  | { readonly provide: ProviderToken<T>; readonly useValue: T }
  | { readonly provide: ProviderToken<T>; readonly useFactory: () => T; readonly scope?: ProviderLifetime }
  | { readonly provide: ProviderToken<T>; readonly useExisting: ProviderToken<T> };

/** Registration helper with a readable, statically analyzable call shape; normalizes to the core `Provider<T>` shape. */
export function Provider<T>(definition: ProviderDefinition<T>): Provider<T> {
  if (typeof definition === "function") return definition;
  const { provide: token, ...rest } = definition;
  return { token, ...rest } as Provider<T>;
}
