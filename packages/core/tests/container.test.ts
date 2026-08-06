import { describe, expect, test } from "bun:test";
import { CircularDependencyError, Container, ProviderNotFoundError, createInjectionToken, inject } from "../src";

describe("Container", () => {
  test("resolves singleton class providers", () => {
    class Repository {}
    class Service { readonly repository = inject(Repository); }
    const container = new Container().registerAll([Repository, Service]);
    expect(container.resolve(Service).repository).toBe(container.resolve(Repository));
    expect(container.resolve(Service)).toBe(container.resolve(Service));
  });

  test("resolves value providers", () => {
    const CONFIG = createInjectionToken<{ readonly port: number }>("CONFIG");
    const container = new Container().register({ token: CONFIG, useValue: { port: 3000 } });
    expect(container.resolve(CONFIG).port).toBe(3000);
  });

  test("supports transient providers", () => {
    class Item {}
    const container = new Container().register({ token: Item, useClass: Item, scope: "transient" });
    expect(container.resolve(Item)).not.toBe(container.resolve(Item));
  });

  test("resolves factory providers", () => {
    class Cache {}
    const CACHE = createInjectionToken<Cache>("CACHE");
    const container = new Container().register({ token: CACHE, useFactory: () => new Cache() });
    expect(container.resolve(CACHE)).toBeInstanceOf(Cache);
    expect(container.resolve(CACHE)).toBe(container.resolve(CACHE));
  });

  test("rebuilds transient factory providers on every resolution", () => {
    class Item {}
    const ITEM = createInjectionToken<Item>("ITEM");
    const container = new Container().register({ token: ITEM, useFactory: () => new Item(), scope: "transient" });
    expect(container.resolve(ITEM)).not.toBe(container.resolve(ITEM));
  });

  test("resolves existing providers as an alias to the same instance", () => {
    class Repository {}
    const REPOSITORY_TOKEN = createInjectionToken<Repository>("REPOSITORY");
    const container = new Container().registerAll([
      Repository,
      { token: REPOSITORY_TOKEN, useExisting: Repository },
    ]);
    expect(container.resolve(REPOSITORY_TOKEN)).toBe(container.resolve(Repository));
  });

  test("existing providers do not pin a transient target to one instance", () => {
    class Item {}
    const ALIAS = createInjectionToken<Item>("ALIAS");
    const container = new Container().registerAll([
      { token: Item, useClass: Item, scope: "transient" },
      { token: ALIAS, useExisting: Item },
    ]);
    expect(container.resolve(ALIAS)).not.toBe(container.resolve(ALIAS));
  });

  test("throws ProviderNotFoundError for an unregistered token", () => {
    class Missing {}
    expect(() => new Container().resolve(Missing)).toThrow(ProviderNotFoundError);
  });

  test("resolveOptional returns undefined instead of throwing", () => {
    class Missing {}
    expect(new Container().resolveOptional(Missing)).toBeUndefined();
  });

  test("throws CircularDependencyError for a dependency cycle", () => {
    class A { readonly b = inject(B); }
    class B { readonly a = inject(A); }
    const container = new Container().registerAll([A, B]);
    expect(() => container.resolve(A)).toThrow(CircularDependencyError);
  });
});
