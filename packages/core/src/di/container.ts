import { CircularDependencyError, DuplicateProviderError, ProviderNotFoundError } from "../errors";
import type { Constructor } from "../types";
import type { InjectionResolver } from "./injection-resolver";
import { runInInjectionContext } from "./injection-context";
import type { FactoryProvider, Provider, ProviderLifetime } from "./provider";
import type { ProviderToken } from "./token";
import { tokenName } from "./token";

type ProviderRecord<T> =
  | { readonly kind: "class"; readonly useClass: Constructor<T>; readonly scope: ProviderLifetime }
  | { readonly kind: "factory"; readonly useFactory: () => T; readonly scope: ProviderLifetime }
  | { readonly kind: "value"; readonly useValue: T }
  | { readonly kind: "existing"; readonly useExisting: ProviderToken<T> };

/** Sentinel distinguishing "never resolved" from a resolved value of `undefined`. */
const UNSET: unique symbol = Symbol("unset");

/**
 * Resolves and owns Warbler providers.
 *
 * Internally id-addressed: registration assigns each token a dense local index, and `resolve()` spends
 * exactly one `Map` lookup translating the token to that index — every subsequent step (cache check,
 * cycle detection, factory dispatch) is plain array indexing, not further token-keyed lookups.
 */
export class Container implements InjectionResolver {
  readonly #parent: Container | undefined;
  readonly #ids = new Map<ProviderToken<unknown>, number>();
  readonly #tokens: ProviderToken<unknown>[] = [];
  readonly #records: ProviderRecord<unknown>[] = [];
  readonly #singletons: unknown[] = [];
  readonly #creating: number[] = [];

  /** Creates an isolated container with an optional O(1) root fallback. */
  public constructor(parent?: Container) {
    this.#parent = parent;
  }

  /** Registers one provider definition. */
  register<T>(provider: Provider<T>): this {
    const token = typeof provider === "function" ? provider : provider.token;
    if (this.#ids.has(token)) throw new DuplicateProviderError(tokenName(token));
    const record: ProviderRecord<T> = typeof provider === "function"
      ? { kind: "class", useClass: provider, scope: "singleton" }
      : "useValue" in provider
        ? { kind: "value", useValue: provider.useValue }
        : "useFactory" in provider
          ? { kind: "factory", useFactory: provider.useFactory, scope: provider.scope ?? "singleton" }
          : "useExisting" in provider
            ? { kind: "existing", useExisting: provider.useExisting }
            : { kind: "class", useClass: provider.useClass, scope: provider.scope ?? "singleton" };
    const id = this.#records.length;
    this.#ids.set(token, id);
    this.#tokens.push(token);
    this.#records.push(record);
    this.#singletons.push(UNSET);
    return this;
  }

  /** Registers multiple provider definitions. */
  registerAll(providers: readonly Provider[]): this {
    for (const provider of providers) this.register(provider);
    return this;
  }

  /** Returns whether a provider token is registered. */
  has<T>(token: ProviderToken<T>): boolean {
    return this.#ids.has(token) || (this.#parent?.has(token) ?? false);
  }

  /** Resolves a provider token or throws when unavailable. */
  resolve<T>(token: ProviderToken<T>): T {
    const id = this.#ids.get(token);
    if (id === undefined) {
      if (this.#parent !== undefined) return this.#parent.resolve(token);
      throw new ProviderNotFoundError(tokenName(token));
    }
    return this.#resolveById(id) as T;
  }

  /** Resolves a provider token or returns undefined when unavailable. */
  resolveOptional<T>(token: ProviderToken<T>): T | undefined {
    return this.has(token) ? this.resolve(token) : undefined;
  }

  #resolveById(id: number): unknown {
    const cached = this.#singletons[id]!;
    if (cached !== UNSET) return cached;
    const record = this.#records[id]!;

    const cycleIndex = this.#creating.indexOf(id);
    if (cycleIndex !== -1) {
      const cycle = [...this.#creating.slice(cycleIndex), id].map((item) => tokenName(this.#tokens[item]!));
      throw new CircularDependencyError(cycle);
    }

    this.#creating.push(id);
    try {
      const value = this.#create(record);
      if (record.kind === "value" || (record.kind !== "existing" && record.scope === "singleton")) this.#singletons[id] = value;
      return value;
    } finally {
      this.#creating.pop();
    }
  }

  #create<T>(record: ProviderRecord<T>): T {
    if (record.kind === "value") return record.useValue;
    if (record.kind === "existing") return this.resolve(record.useExisting);
    if (record.kind === "factory") return runInInjectionContext(this, record.useFactory);
    return runInInjectionContext(this, () => new record.useClass());
  }
}
