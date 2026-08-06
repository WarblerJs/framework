import { CircularDependencyError, DuplicateProviderError, ProviderNotFoundError } from "../errors";
import type { Constructor } from "../types";
import { runInInjectionContext } from "./injection-context";
import type { FactoryProvider, Provider, ProviderLifetime } from "./provider";
import type { ProviderToken } from "./token";
import { tokenName } from "./token";

type ProviderRecord<T> =
  | { readonly kind: "class"; readonly useClass: Constructor<T>; readonly scope: ProviderLifetime }
  | { readonly kind: "factory"; readonly useFactory: () => T; readonly scope: ProviderLifetime }
  | { readonly kind: "value"; readonly useValue: T }
  | { readonly kind: "existing"; readonly useExisting: ProviderToken<T> };

/** Resolves and owns Warbler providers. */
export class Container {
  readonly #parent: Container | undefined;
  readonly #records = new Map<ProviderToken<unknown>, ProviderRecord<unknown>>();
  readonly #singletons = new Map<ProviderToken<unknown>, unknown>();
  readonly #resolving: ProviderToken<unknown>[] = [];

  /** Creates an isolated container with an optional O(1) root fallback. */
  public constructor(parent?: Container) {
    this.#parent = parent;
  }

  /** Registers one provider definition. */
  register<T>(provider: Provider<T>): this {
    const token = typeof provider === "function" ? provider : provider.token;
    if (this.#records.has(token)) throw new DuplicateProviderError(tokenName(token));
    if (typeof provider === "function") {
      this.#records.set(provider, { kind: "class", useClass: provider, scope: "singleton" });
      return this;
    }
    if ("useValue" in provider) {
      this.#records.set(provider.token, { kind: "value", useValue: provider.useValue });
      return this;
    }
    if ("useFactory" in provider) {
      this.#records.set(provider.token, { kind: "factory", useFactory: provider.useFactory, scope: provider.scope ?? "singleton" });
      return this;
    }
    if ("useExisting" in provider) {
      this.#records.set(provider.token, { kind: "existing", useExisting: provider.useExisting });
      return this;
    }
    this.#records.set(provider.token, { kind: "class", useClass: provider.useClass, scope: provider.scope ?? "singleton" });
    return this;
  }

  /** Registers multiple provider definitions. */
  registerAll(providers: readonly Provider[]): this {
    for (const provider of providers) this.register(provider);
    return this;
  }

  /** Returns whether a provider token is registered. */
  has<T>(token: ProviderToken<T>): boolean {
    return this.#records.has(token) || (this.#parent?.has(token) ?? false);
  }

  /** Resolves a provider token or throws when unavailable. */
  resolve<T>(token: ProviderToken<T>): T {
    const existing = this.#singletons.get(token);
    if (existing !== undefined || this.#singletons.has(token)) return existing as T;
    const record = this.#records.get(token) as ProviderRecord<T> | undefined;
    if (!record) {
      if (this.#parent !== undefined) return this.#parent.resolve(token);
      throw new ProviderNotFoundError(tokenName(token));
    }

    const cycleIndex = this.#resolving.indexOf(token);
    if (cycleIndex !== -1) {
      const cycle = [...this.#resolving.slice(cycleIndex), token].map(tokenName);
      throw new CircularDependencyError(cycle);
    }

    this.#resolving.push(token);
    try {
      const value = this.#create(record);
      if (record.kind === "value" || (record.kind !== "existing" && record.scope === "singleton")) this.#singletons.set(token, value);
      return value;
    } finally {
      this.#resolving.pop();
    }
  }

  /** Resolves a provider token or returns undefined when unavailable. */
  resolveOptional<T>(token: ProviderToken<T>): T | undefined {
    return this.has(token) ? this.resolve(token) : undefined;
  }

  #create<T>(record: ProviderRecord<T>): T {
    if (record.kind === "value") return record.useValue;
    if (record.kind === "existing") return this.resolve(record.useExisting);
    if (record.kind === "factory") return runInInjectionContext(this, record.useFactory);
    return runInInjectionContext(this, () => new record.useClass());
  }
}
