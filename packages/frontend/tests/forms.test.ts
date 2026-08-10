import { describe, expect, test } from "bun:test";
import { normalizeServerErrors, submissionMode } from "../src/forms/submit";
import { transitionInteractionState } from "../src/forms/state";
import { validators } from "../src/forms/validators";
import type { InferFormValue } from "../src/forms/types";

describe("Forms validators", () => {
  test("widens initial literals into useful strongly typed form values", () => {
    type Login = InferFormValue<{
      readonly email: readonly ["initial@example.com"];
      readonly attempts: readonly [0];
      readonly remember: readonly [false];
    }>;
    const value: Login = { email: "next@example.com", attempts: 2, remember: true };
    expect(value).toEqual({ email: "next@example.com", attempts: 2, remember: true });
  });

  test("defines messages and native constraints without restricting Unicode strings", () => {
    expect(validators.required("Required")).toMatchObject({
      message: "Required",
      constraint: { required: true },
    });
    expect(validators.email().constraint).toEqual({ type: "email" });
    expect(validators.minLength(8).constraint).toEqual({ minLength: 8 });
    expect(validators.maxLength(20).constraint).toEqual({ maxLength: 20 });
    expect(validators.min(1).constraint).toEqual({ min: 1 });
    expect(validators.max(10).constraint).toEqual({ max: 10 });
    expect(validators.pattern(/[A-Za-z]{3}/).constraint).toEqual({ pattern: "[A-Za-z]{3}" });
    expect(validators.string().validate("مرحبا 👋 123")).toBe(true);
    expect(validators.minLength(8).validate("")).toBe(true);
  });

  test("aggregates generic match and form-level validation", () => {
    type Registration = Readonly<{ password: string; confirmPassword: string; age: number }>;
    const match = validators.match<Registration, "password" | "confirmPassword">(
      "password", "confirmPassword", "Passwords do not match",
    );
    const adult = validators.form<Registration, "age">(
      (value) => value.age >= 18,
      { field: "age", message: "Adults only" },
    );
    const value = { password: "one", confirmPassword: "two", age: 16 } as const;
    expect(match.validate(value)).toEqual({ field: "confirmPassword", message: "Passwords do not match" });
    expect(adult.validate(value)).toEqual({ field: "age", message: "Adults only" });
  });
});

describe("Forms state and submission logic", () => {
  test("keeps touched and dirty transitions independent", () => {
    const initial = Object.freeze({ touched: false, dirty: false });
    const touched = transitionInteractionState(initial, "touch");
    const dirty = transitionInteractionState(touched, "dirty");
    expect(initial).toEqual({ touched: false, dirty: false });
    expect(dirty).toEqual({ touched: true, dirty: true });
    expect(transitionInteractionState(dirty, "pristine")).toEqual({ touched: true, dirty: false });
  });

  test("uses action attribute presence to select native or fetch submission", () => {
    expect(submissionMode(true)).toBe("native");
    expect(submissionMode(false)).toBe("fetch");
  });

  test("strictly normalizes common server errors", () => {
    expect(normalizeServerErrors({
      message: "Invalid login",
      errors: { email: "Unknown email", password: "Wrong password", count: 2 },
    })).toEqual({
      message: "Invalid login",
      fields: { email: "Unknown email", password: "Wrong password" },
    });
    expect(normalizeServerErrors("not-json-object")).toEqual({ fields: {} });
  });
});
