import { describe, expect, test } from "bun:test";
import { Container, MissingInjectionContextError, inject, runInInjectionContext } from "../src";

describe("inject", () => {
  test("throws outside an injection context", () => {
    class Service {}
    expect(() => inject(Service)).toThrow(MissingInjectionContextError);
  });

  test("resolves inside an injection context", () => {
    class Service {}
    const container = new Container().register(Service);
    const result = runInInjectionContext(container, () => inject(Service));
    expect(result).toBeInstanceOf(Service);
  });
});
