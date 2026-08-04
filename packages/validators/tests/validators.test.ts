import { describe, expect, test } from "bun:test";
import {
  ValidatorError, compileValidator, firstTranslatedValidationErrors,
  messageDescriptorCacheSize, parseMessageDescriptor, translateValidationErrors,
  type InferValidatorBody, type InferValidatorOutput, type InferValidatorPath,
  type InferValidatorQuery, type RequestValidator, v,
} from "../src";

describe("public Zod API and compilation", () => {
  test("exports Zod without replacing its schema API", () => {
    expect(v.string().safeParse("value").success).toBe(true);
    expect(v.coerce.number().parse("5")).toBe(5);
  });
  test("builds strict schemas once, skips absent sections, and freezes the binding", () => {
    const definition = { rules: { name: v.string("invalid_string") } } satisfies RequestValidator;
    const compiled = compileValidator(definition, 4);
    expect(compiled.id).toBe(4);
    expect(compiled.bodySchema).toBeDefined();
    expect(compiled.querySchema).toBeUndefined();
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(compiled.execute({ value: { name: "bird", extra: true } }).valid).toBe(false);
  });
  test("rejects empty, malformed, and prototype-polluting rule definitions", () => {
    expect(() => compileValidator({ rules: {} })).toThrow("VALIDATOR1002");
    const unsafe: Record<string, v.ZodType> = Object.create(null);
    unsafe.__proto__ = v.string();
    expect(() => compileValidator({ rules: unsafe })).toThrow("VALIDATOR1002");
  });
});

describe("validation execution", () => {
  const compiled = compileValidator({
    rules: {
      username: v.string("validators.username_not_valid").min(1, "validators.username_not_valid"),
      password: v.string("invalid_string").max(5, "max_message:allowed::entered"),
    },
    queryRules: { page: v.coerce.number("validators.invalid_page").int().positive() },
    pathRules: { id: v.coerce.number("validators.invalid_id").int().positive() },
    headerRules: { "x-tenant": v.string("validators.invalid_tenant") },
    cookieRules: { session: v.string("validators.invalid_session") },
  });
  test("validates and coerces every defined plain source synchronously", () => {
    const result = compiled.execute({
      value: { username: "habib", password: "12345" },
      query: { page: "2" }, path: { id: "10" },
      headers: { "X-Tenant": "one" }, cookies: { session: "abc" },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.query).toEqual({ page: 2 });
    expect(result.path).toEqual({ id: 10 });
    expect(result.headers).toEqual({ "x-tenant": "one" });
    expect(result instanceof Promise).toBe(false);
  });
  test("collects all source and field errors without sensitive received values", () => {
    const result = compiled.execute({
      value: { username: 5, password: "too-long-secret" },
      query: { page: "bad" }, path: { id: "-1" },
      headers: {}, cookies: {},
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(result.errors)).not.toContain("too-long-secret");
    const password = result.errors["body.password"]![0]!;
    expect(password.message).toEqual({ key: "max_message", parameters: { allowed: 5, entered: 15 } });
  });
});

describe("messages and translation", () => {
  test("parses and caches secure translation descriptors", () => {
    const before = messageDescriptorCacheSize();
    const first = parseMessageDescriptor("validators.auth.failed:expected::received");
    const after = messageDescriptorCacheSize();
    expect(parseMessageDescriptor("validators.auth.failed:expected::received")).toBe(first);
    expect(after).toBeGreaterThanOrEqual(before);
    for (const value of [":key", "message:", "message::", "message:param:", "message:../secret", "message:param/name"]) {
      expect(() => parseMessageDescriptor(value)).toThrow(ValidatorError);
    }
  });
  test("translates all or first issues without owning locale state", () => {
    const result = compileValidator({ rules: { name: v.string("invalid_string") } }).execute({ value: { name: 2 } });
    if (result.valid) throw new Error("Expected validation failure");
    const translate = (key: string): string => `translated:${key}`;
    expect(firstTranslatedValidationErrors(result.errors, translate)["body.name"]).toBe("translated:invalid_string");
    expect(translateValidationErrors(result.errors, translate)["body.name"]).toEqual(["translated:invalid_string"]);
  });
});

describe("value and key mapping", () => {
  test("executes mapV then mapK without mutating input", () => {
    const input = Object.freeze({ username: "habib", password: "secret" });
    const compiled = compileValidator({
      rules: { username: v.string("invalid_string"), password: v.string("invalid_string") },
      mapV: (body) => ({ ...body, password: `${body.password}##@@`, email: "habib@test" }),
      mapK: { username: "name" },
    });
    const result = compiled.execute({ value: input });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({ name: "habib", password: "secret##@@", email: "habib@test" });
    expect("username" in (result.value as Readonly<Record<string, unknown>>)).toBe(false);
    expect(input).toEqual({ username: "habib", password: "secret" });
  });
  test("rejects missing, duplicate, empty, and unsafe mappings", () => {
    const rules = { first: v.string(), second: v.string() };
    expect(() => compileValidator({ rules, mapK: { missing: "name" } })).toThrow("VALIDATOR1006");
    expect(() => compileValidator({ rules, mapK: { first: "name", second: "name" } })).toThrow("VALIDATOR1007");
    expect(() => compileValidator({ rules, mapK: { first: "" } })).toThrow("VALIDATOR1006");
    expect(() => compileValidator({ rules, mapK: { first: "__proto__" } })).toThrow("VALIDATOR1008");
  });
  test("rejects asynchronous mapV without changing the sync hot path", () => {
    const compiled = compileValidator({
      rules: { value: v.string() },
      mapV: (() => Promise.resolve({ value: "x" })) as unknown as RequestValidator["mapV"],
    });
    expect(() => compiled.execute({ value: { value: "x" } })).toThrow("VALIDATOR1009");
  });
  test("normalizes an asynchronous Zod refinement mismatch", () => {
    const compiled = compileValidator({
      rules: { value: v.string().refine(async () => true) },
    });
    expect(() => compiled.execute({ value: { value: "x" } })).toThrow("VALIDATOR1009");
  });
});

describe("inference helpers", () => {
  const definition = {
    rules: { username: v.string(), password: v.string() },
    queryRules: { page: v.coerce.number() },
    pathRules: { id: v.coerce.number() },
    mapV: (body: Readonly<{ username: string; password: string }>) => ({ ...body, email: "habib@test" }),
    mapK: { username: "name" },
  } as const;
  test("infers body, query, path, mapV additions, and mapK removals", () => {
    const body: InferValidatorBody<typeof definition> = { username: "h", password: "p" };
    const query: InferValidatorQuery<typeof definition> = { page: 1 };
    const path: InferValidatorPath<typeof definition> = { id: 2 };
    const output: InferValidatorOutput<typeof definition> = { name: "h", password: "p", email: "habib@test" };
    expect({ body, query, path, output }).toBeDefined();
    // @ts-expect-error mapK removes username from the final type.
    const removed: string = output.username;
    expect(removed).toBeUndefined();
  });
});
