import { describe, expect, test } from "bun:test";
import { compileValidator, defineValidator, v } from "../src";

describe("onValidationError definition", () => {
  test("is accepted by defineValidator and survives freezing untouched", () => {
    const handler = () => new Response(null);
    const validator = defineValidator({
      bodyRules: { name: v.string() },
      onValidationError: handler,
    });
    expect(validator.onValidationError).toBe(handler);
    expect(Object.isFrozen(validator)).toBe(true);
  });

  test("existing validators without onValidationError are unaffected", () => {
    const validator = defineValidator({ bodyRules: { name: v.string() } });
    expect(validator.onValidationError).toBeUndefined();
  });
});

describe("onValidationError compilation", () => {
  test("is carried onto the compiled validator and does not change execute() output", () => {
    const handler = () => new Response(null);
    const withHandler = compileValidator({ bodyRules: { name: v.string("invalid_name") }, onValidationError: handler });
    const withoutHandler = compileValidator({ bodyRules: { name: v.string("invalid_name") } });
    expect(withHandler.onValidationError).toBe(handler);
    expect(withoutHandler.onValidationError).toBeUndefined();
    const input = { value: { name: 5 } };
    expect(withHandler.execute(input)).toEqual(withoutHandler.execute(input));
  });

  test("rejects a non-function onValidationError", () => {
    expect(() => compileValidator({
      bodyRules: { name: v.string() },
      onValidationError: "not-a-function",
    } as never)).toThrow("VALIDATOR1001");
  });

  test("survives compilation independently across every rule source, and combined", () => {
    const handler = () => new Response(null);
    const sections = [
      { bodyRules: { name: v.string() } },
      { queryRules: { page: v.number() } },
      { paramRules: { id: v.string() } },
      { headerRules: { "x-retries": v.number() } },
      { cookieRules: { session: v.string() } },
      {
        bodyRules: { name: v.string() },
        queryRules: { page: v.number() },
        paramRules: { id: v.string() },
        headerRules: { "x-retries": v.number() },
        cookieRules: { session: v.string() },
      },
    ] as const;
    for (const definition of sections) {
      const compiled = compileValidator({ ...definition, onValidationError: handler });
      expect(compiled.onValidationError).toBe(handler);
    }
  });

  test("execute() still tags failing sources correctly when onValidationError is present", () => {
    const compiled = compileValidator({
      bodyRules: { name: v.string("invalid_name") },
      paramRules: { id: v.uuid("invalid_id") },
      onValidationError: () => new Response(null),
    });
    const result = compiled.execute({ value: { name: 1 }, path: { id: "not-a-uuid" } });
    if (result instanceof Promise) throw new Error("Expected synchronous validation result");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(Object.keys(result.errors)).toEqual(["body.name", "path.id"]);
    expect(result.errors["body.name"]![0]!.source).toBe("body");
    expect(result.errors["path.id"]![0]!.source).toBe("path");
  });
});
