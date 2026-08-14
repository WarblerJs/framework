import { describe, expect, test } from "bun:test";
import { type Either, left, right } from "../src";

function expectType<T>(_value: T): void {}

describe("Either", () => {
  test("left() creates a frozen Left branch", () => {
    const result = left("EMAIL_EXIST");
    expect(result._tag).toBe("Left");
    expect(result.value).toBe("EMAIL_EXIST");
    expect(result.isLeft()).toBe(true);
    expect(result.isRight()).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("right() creates a frozen Right branch", () => {
    const user = Object.freeze({ id: "user_1", email: "a@example.com" });
    const result = right(user);
    expect(result._tag).toBe("Right");
    expect(result.value).toBe(user);
    expect(result.isLeft()).toBe(false);
    expect(result.isRight()).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("isLeft() narrows to the expected business failure payload", () => {
    const result: Either<"EMAIL_EXIST", { readonly id: string }> = left("EMAIL_EXIST");
    if (result.isLeft()) {
      expectType<"EMAIL_EXIST">(result.value);
      expect(result.value).toBe("EMAIL_EXIST");
    } else {
      expectType<{ readonly id: string }>(result.value);
    }
  });

  test("isRight() narrows to the successful value payload", () => {
    const result: Either<"EMAIL_EXIST", { readonly id: string }> = right({ id: "user_1" });
    if (result.isRight()) {
      expectType<{ readonly id: string }>(result.value);
      expect(result.value.id).toBe("user_1");
    } else {
      expectType<"EMAIL_EXIST">(result.value);
    }
  });

  test("match() invokes the left branch exhaustively", () => {
    const result: Either<"USERNAME_TAKEN", number> = left("USERNAME_TAKEN");
    expect(result.match({
      left: (error) => `error:${error}`,
      right: (value) => `value:${value}`,
    })).toBe("error:USERNAME_TAKEN");
  });

  test("match() invokes the right branch exhaustively", () => {
    const result: Either<"USERNAME_TAKEN", number> = right(42);
    expect(result.match({
      left: (error) => `error:${error}`,
      right: (value) => `value:${value}`,
    })).toBe("value:42");
  });

  test("map() transforms Right and passes Left through without allocating", () => {
    const failure = left("INVALID_STATE_TRANSITION");
    const unchanged = failure.map(() => 42);
    expect(unchanged).toBe(failure);

    const success = right(21).map((value) => value * 2);
    expect(success.isRight()).toBe(true);
    expect(success.unwrap()).toBe(42);
  });

  test("mapLeft() transforms Left and passes Right through without allocating", () => {
    const success = right({ paid: true });
    const unchanged = success.mapLeft(() => "ORDER_ALREADY_PAID" as const);
    expect(unchanged).toBe(success);

    const failure = left("email_exist").mapLeft((error) => error.toUpperCase());
    expect(failure.isLeft()).toBe(true);
    expect(failure.value).toBe("EMAIL_EXIST");
  });

  test("unwrap() returns Right values and throws for Left values", () => {
    expect(right("ok").unwrap()).toBe("ok");
    expect(() => left("EXPECTED_FAILURE").unwrap()).toThrow("Cannot unwrap Left Either.");
  });

  test("unwrapOr() returns Right values or the provided fallback", () => {
    expect(right(7).unwrapOr(0)).toBe(7);
    expect(left("INSUFFICIENT_BALANCE").unwrapOr(0)).toBe(0);
  });

  test("supports async use-case usage end to end", async () => {
    enum AppErrorCode {
      EMAIL_EXIST = "EMAIL_EXIST",
    }
    interface CreateUserData {
      readonly email: string;
    }
    interface UserEntity {
      readonly id: string;
      readonly email: string;
    }
    const existing = new Set(["taken@example.com"]);
    const register = {
      async emailExist(email: string): Promise<boolean> {
        return existing.has(email);
      },
      async createNewUser(data: CreateUserData): Promise<UserEntity> {
        return Object.freeze({ id: "user_1", email: data.email });
      },
    };
    async function execute(data: CreateUserData): Promise<Either<AppErrorCode, UserEntity>> {
      if (await register.emailExist(data.email)) return left(AppErrorCode.EMAIL_EXIST);
      return right(await register.createNewUser(data));
    }

    const failure = await execute({ email: "taken@example.com" });
    const success = await execute({ email: "new@example.com" });

    expect(failure.match({
      left: (error) => error,
      right: (user) => user.email,
    })).toBe(AppErrorCode.EMAIL_EXIST);
    expect(success.match({
      left: (error) => error,
      right: (user) => user.email,
    })).toBe("new@example.com");
  });

  test("infers generics for common enum, union, object, primitive, and object value cases", () => {
    enum ErrorCode {
      EMAIL_EXIST = "EMAIL_EXIST",
    }
    type DomainError = "USERNAME_TAKEN" | "INVALID_STATE_TRANSITION";
    const objectError = Object.freeze({ code: "ORDER_ALREADY_PAID" as const, orderId: "ord_1" });
    const unionError: DomainError = "USERNAME_TAKEN";

    const enumLeft = left(ErrorCode.EMAIL_EXIST);
    const unionLeft = left(unionError);
    const objectLeft = left(objectError);
    const primitiveRight = right(123);
    const objectRight = right(Object.freeze({ id: "user_1" }));
    const mappedRight = primitiveRight.map((value) => String(value));
    const mappedLeft = unionLeft.mapLeft((error) => ({ error }));

    expectType<Either<ErrorCode, never>>(enumLeft);
    expectType<Either<DomainError, never>>(unionLeft);
    expectType<Either<typeof objectError, never>>(objectLeft);
    expectType<Either<never, number>>(primitiveRight);
    expectType<Either<never, Readonly<{ id: string }>>>(objectRight);
    expectType<Either<never, string>>(mappedRight);
    expectType<Either<{ readonly error: DomainError }, never>>(mappedLeft);

    expect(enumLeft.value).toBe(ErrorCode.EMAIL_EXIST);
    expect(objectLeft.value.orderId).toBe("ord_1");
    expect(primitiveRight.unwrap()).toBe(123);
    expect(objectRight.unwrap().id).toBe("user_1");
  });
});
