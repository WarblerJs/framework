import { describe, expect, test } from "bun:test";
import { Container, createInjectionToken, inject } from "../src";

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
});
