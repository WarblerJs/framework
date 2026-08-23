import { describe, expect, test } from "bun:test";
import {
  ValidatorError,
  compileValidator,
  defineValidator,
  firstTranslatedValidationErrors,
  messageDescriptorCacheSize,
  parseMessageDescriptor,
  translateValidationErrors,
  type InferValidatorBody,
  type InferValidatorOutput,
  type InferValidatorPath,
  type InferValidatorQuery,
  type MaybePromise,
  type ValidationResult,
  v,
} from "../src";

function syncResult(value: MaybePromise<ValidationResult>): ValidationResult {
  if (value instanceof Promise) throw new Error("Expected synchronous validation result");
  return value;
}

describe("native validator builder", () => {
  test("builds immutable Warbler field definitions without exposing legacy compatibility APIs", () => {
    const field = v.string("invalid_name").min(1).mapV((value) => value.toUpperCase());
    expect(field.__warblerField).toBe(true);
    expect(field.__warblerSpec.kind).toBe("string");
    expect(field.__warblerSpec.rules.length).toBe(1);
    expect(Object.isFrozen(field)).toBe(true);
    expect("coerce" in v).toBe(false);
  });

  test("compileValidator accepts only explicit Warbler validator fields", () => {
    expect(() => compileValidator({ bodyRules: { name: "string" } as never })).toThrow("VALIDATOR1002");
    expect(() => compileValidator({ bodyRules: [] as never })).toThrow("VALIDATOR1002");
  });

  test("rejects prototype pollution keys before creating a compiled validator", () => {
    const unsafe: Record<string, ReturnType<typeof v.string>> = Object.create(null);
    Object.defineProperty(unsafe, "__proto__", { value: v.string(), enumerable: true });
    expect(() => compileValidator({ bodyRules: unsafe })).toThrow("VALIDATOR1002");
  });
});

describe("native validation execution", () => {
  test("parses body, query, path, headers, cookies, message, and metadata independently", () => {
    const validator = compileValidator({
      bodyRules: { name: v.string().min(2) },
      queryRules: { page: v.number().int().positive() },
      paramRules: { id: v.uuid() },
      headerRules: { "x-retries": v.number().int().gte(0) },
      cookieRules: { session: v.string().min(3) },
      messageRules: { retry: v.boolean() },
      metadataRules: { at: v.date() },
    });

    const result = syncResult(validator.execute({
      value: { name: "Ada" },
      query: { page: "2" },
      path: { id: "550e8400-e29b-41d4-a716-446655440000" },
      headers: { "x-retries": "0" },
      cookies: { session: "abc" },
      message: { retry: "true" },
      metadata: { at: "2026-01-01T00:00:00.000Z" },
    }));

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({ name: "Ada" });
    expect(result.query).toEqual({ page: 2 });
    expect(result.path).toEqual({ id: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result.headers).toEqual({ "x-retries": 0 });
    expect(result.cookies).toEqual({ session: "abc" });
    expect(result.message).toEqual({ retry: true });
    expect((result.metadata as Readonly<Record<string, unknown>>).at).toBeInstanceOf(Date);
  });

  test("groups errors by source path without leaking raw sensitive values", () => {
    const validator = compileValidator({
      bodyRules: { password: v.string("invalid_password").min(12, "password_too_short") },
      queryRules: { page: v.number("invalid_page").int("invalid_page") },
    });
    const result = syncResult(validator.execute({ value: { password: "secret" }, query: { page: "x" } }));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(Object.keys(result.errors).sort()).toEqual(["body.password", "query.page"]);
    expect(result.errors["body.password"]![0]!.code).toBe("too_small");
    expect(JSON.stringify(result.errors)).not.toContain("secret");
  });

  test("validates root body arrays with bodyRule", () => {
    const validator = compileValidator(defineValidator({ bodyRule: v.array(v.number()).min(2) }));
    const result = syncResult(validator.execute({ value: ["1", 2] }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual([1, 2]);
  });

  test("supports object and array nesting", () => {
    const validator = compileValidator({
      bodyRules: {
        user: v.object({ email: v.email(), tags: v.array(v.string().min(2)).min(1) }),
      },
    });
    const result = syncResult(validator.execute({ value: { user: { email: "a@b.com", tags: ["ts"] } } }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({ user: { email: "a@b.com", tags: ["ts"] } });
  });

  test("handles price rules without floating point comparisons", () => {
    const validator = compileValidator({
      bodyRules: {
        amount: v.price("invalid_price", { scale: 2 }).gte("10.00", "too_low").lte("20.00", "too_high"),
      },
    });
    expect(syncResult(validator.execute({ value: { amount: "10.01" } })).valid).toBe(true);
    const result = syncResult(validator.execute({ value: { amount: "9.99" } }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors["body.amount"]![0]!.message.key).toBe("too_low");
  });

  test("validates file-like values using native file predicates", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const validator = compileValidator({ bodyRules: { upload: v.file().maxSize(10).mime(["text/plain"]) } });
    const result = syncResult(validator.execute({ value: { upload: file } }));
    expect(result.valid).toBe(true);
  });
});

describe("presence, rejection, and stages", () => {
  test("applies presence dependencies", () => {
    const validator = compileValidator({
      bodyRules: {
        password: v.string().requiredWith("email", "password_required"),
        email: v.email().optional(),
      },
    });
    const result = syncResult(validator.execute({ value: { email: "a@b.com" } }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors["body.password"]![0]!.message.key).toBe("password_required");
  });

  test("allows presence dependencies on safe raw input keys that are not declared fields", () => {
    const validator = compileValidator({
      headerRules: {
        "x-pow": v.string("pow_required").requiredWith("x-al"),
        "x-mode": v.string("mode_required").requiredWhen("x-raw-mode", "strict"),
      },
    });

    const requiredWith = syncResult(validator.execute({ headers: { "x-al": "1" } }));
    expect(requiredWith.valid).toBe(false);
    if (requiredWith.valid) return;
    expect(requiredWith.errors["headers.x-pow"]![0]!.message.key).toBe("pow_required");
    expect(requiredWith.errors["headers.x-al"]).toBeUndefined();

    const requiredWhen = syncResult(validator.execute({ headers: { "x-raw-mode": "strict" } }));
    expect(requiredWhen.valid).toBe(false);
    if (requiredWhen.valid) return;
    expect(requiredWhen.errors["headers.x-mode"]![0]!.message.key).toBe("mode_required");
    expect(requiredWhen.errors["headers.x-raw-mode"]).toBeUndefined();
  });

  test("runs rejectIf, after, field mappings, patch, and map in deterministic order", () => {
    const order: string[] = [];
    const validator = compileValidator(defineValidator({
      bodyRules: {
        email: v.string()
          .rejectIf((value) => { order.push(`reject:${value}`); return false; })
          .mapV((value) => { order.push(`mapV:${value}`); return value.toLowerCase(); })
          .mapK("email_user"),
        confirm: v.string(),
      },
    })
      .after((input, reject) => {
        const body = input.body as unknown as Readonly<{ email: string; confirm: string }>;
        order.push(`after:${body.email}`);
        if (body.email !== body.confirm) reject("body.confirm", "mismatch");
      })
      .patch((input) => {
        const body = input.body as Readonly<{ email_user: string; confirm: string }>;
        order.push(`patch:${body.email_user}`);
        return { body: { domain: body.email_user.split("@")[1] } };
      })
      .map((input) => {
        const body = input.body as Readonly<Record<string, string>>;
        order.push(`map:${body.domain}`);
        return { email: body.email_user, domain: body.domain };
      }));

    const result = syncResult(validator.execute({
      value: { email: "ADA@EXAMPLE.COM", confirm: "ADA@EXAMPLE.COM" },
    }));

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({ email: "ada@example.com", domain: "example.com" });
    expect(order).toEqual([
      "reject:ADA@EXAMPLE.COM",
      "after:ADA@EXAMPLE.COM",
      "mapV:ADA@EXAMPLE.COM",
      "patch:ada@example.com",
      "map:example.com",
    ]);
  });

  test("runs async rejectIf predicates with bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const field = v.string().rejectIf(async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return value === "taken";
    }, "taken");
    const validator = compileValidator(defineValidator({ bodyRules: { a: field, b: field, c: field } }, { asyncConcurrency: 2 }));
    const result = await validator.execute({ value: { a: "ok", b: "taken", c: "ok" } });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors["body.b"]![0]!.message.key).toBe("taken");
  });
});

describe("messages and type inference", () => {
  test("parses and translates validator messages with cached descriptors", () => {
    const before = messageDescriptorCacheSize();
    const descriptor = parseMessageDescriptor("validators.min:minimum");
    expect(parseMessageDescriptor("validators.min:minimum")).toBe(descriptor);
    expect(messageDescriptorCacheSize()).toBeGreaterThanOrEqual(before + 1);

    const validator = compileValidator({ bodyRules: { name: v.string("validators.string").min(3, "validators.min:minimum") } });
    const result = syncResult(validator.execute({ value: { name: "ab" } }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(translateValidationErrors(result.errors, (key, params) => `${key}:${params?.minimum ?? ""}`)["body.name"]).toEqual(["validators.min:3"]);
    expect(firstTranslatedValidationErrors(result.errors, (key) => key)["body.name"]).toBe("validators.min");
  });

  test("throws on invalid global mapping definitions", () => {
    expect(() => compileValidator({
      bodyRules: { name: v.string() },
      mapK: { missing: "renamed" },
    })).toThrow("VALIDATOR1006");
    expect(() => compileValidator({
      bodyRules: { name: v.string() },
      mapV: { missing: (value: unknown) => value },
    } as never)).toThrow("VALIDATOR1001");
  });

  test("rejects asynchronous mapV callbacks", () => {
    const validator = compileValidator({
      bodyRules: { name: v.string().mapV(async (value) => value) },
    });
    expect(() => validator.execute({ value: { name: "Ada" } })).toThrow("VALIDATOR1009");
  });

  test("infers request output types from native validators", () => {
    const definition = defineValidator({
      bodyRules: { name: v.string(), age: v.number().optional() },
      paramRules: { id: v.uuid() },
      queryRules: { page: v.number() },
    });
    const body: InferValidatorBody<typeof definition> = { name: "Ada" };
    const path: InferValidatorPath<typeof definition> = { id: "550e8400-e29b-41d4-a716-446655440000" };
    const query: InferValidatorQuery<typeof definition> = { page: 2 };
    const output: InferValidatorOutput<typeof definition> = body;
    expect({ body, path, query, output }).toBeDefined();
  });

  test("allows native definitions to surface ValidatorError codes", () => {
    try {
      compileValidator({ bodyRule: v.string(), bodyRules: { name: v.string() } });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidatorError);
      expect((error as ValidatorError).code).toBe("VALIDATOR1014_INVALID_ROOT_BODY");
    }
  });
});
