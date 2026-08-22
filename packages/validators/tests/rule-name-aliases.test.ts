import { describe, expect, test } from "bun:test";
import {
  compileValidator, defineValidator,
  type InferValidatorBody, type InferValidatorPath, type MaybePromise, type ValidationResult, v,
} from "../src";

function syncResult(value: MaybePromise<ValidationResult>): ValidationResult {
  if (value instanceof Promise) throw new Error("Expected synchronous validation result");
  return value;
}

describe("bodyRules / paramRules naming", () => {
  test("bodyRules and paramRules compile to the same validators as the deprecated rules/pathRules aliases", () => {
    const legacy = compileValidator({
      rules: { name: v.string("invalid_string") },
      pathRules: { id: v.number("invalid_id") },
    });
    const renamed = compileValidator({
      bodyRules: { name: v.string("invalid_string") },
      paramRules: { id: v.number("invalid_id") },
    });
    const input = { value: { name: "bird" }, path: { id: "10" } };
    expect(syncResult(renamed.execute(input))).toEqual(syncResult(legacy.execute(input)));
    expect(renamed.flags).toBe(legacy.flags);
  });

  test("paramsRules remains accepted as a path rules alias", () => {
    const compiled = compileValidator({
      bodyRules: { name: v.string("invalid_string") },
      paramsRules: { id: v.number("invalid_id") },
    });
    const result = syncResult(compiled.execute({ value: { name: "bird" }, path: { id: "10" } }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.path).toEqual({ id: 10 });
  });

  test("rejects specifying both bodyRules and rules for the same section", () => {
    expect(() => compileValidator({
      rules: { name: v.string() },
      bodyRules: { name: v.string() },
    })).toThrow("VALIDATOR1001");
  });

  test("rejects specifying both paramRules and pathRules for the same section", () => {
    expect(() => compileValidator({
      pathRules: { id: v.number() },
      paramRules: { id: v.number() },
    })).toThrow("VALIDATOR1001");
    expect(() => compileValidator({
      paramRules: { id: v.number() },
      paramsRules: { id: v.number() },
    })).toThrow("VALIDATOR1001");
  });

  test("defineValidator freezes bodyRules/paramRules and still throws on ambiguous definitions", () => {
    const validator = defineValidator({
      bodyRules: { name: v.string() },
      paramRules: { id: v.number() },
    });
    expect(Object.isFrozen(validator.bodyRules)).toBe(true);
    expect(Object.isFrozen(validator.paramRules)).toBe(true);
    expect(() => defineValidator({
      rules: { name: v.string() },
      bodyRules: { name: v.string() },
    })).toThrow("VALIDATOR1001");
  });

  test("mapK resolves known keys from bodyRules the same way it does from rules", () => {
    const compiled = compileValidator({
      bodyRules: { first: v.string(), second: v.string() },
      mapK: { first: "renamed" },
    });
    const result = compiled.execute({ value: { first: "a", second: "b" } });
    if (result instanceof Promise) throw new Error("Expected synchronous validation result");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({ renamed: "a", second: "b" });
  });

  test("InferValidatorBody/Path prefer the new names when both a new- and old-name type slot exist", () => {
    const definition = {
      bodyRules: { username: v.string() },
      paramRules: { id: v.number() },
    } as const;
    const body: InferValidatorBody<typeof definition> = { username: "h" };
    const path: InferValidatorPath<typeof definition> = { id: 1 };
    expect({ body, path }).toBeDefined();
  });
});
