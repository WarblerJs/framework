import { describe, expect, test } from "bun:test";
import {
  BadRequestError,
  ConflictError,
  errorCauseChain,
  ForbiddenError,
  NotFoundError,
  normalizeError,
  safeErrorMessage,
  UnauthorizedError,
  WarblerError,
} from "../src";

describe("WarblerError", () => {
  test("the spec's literal example works unchanged", () => {
    const error = new WarblerError("USER_NOT_FOUND", 404, "User not found");
    expect(error.code).toBe("USER_NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.message).toBe("User not found");
    expect(error.expose).toBe(true);
    expect(error.fatal).toBe(false);
    expect(error).toBeInstanceOf(Error);
  });

  test("falls back to code as the message when none is given", () => {
    const error = new WarblerError("SOMETHING_FAILED", 500);
    expect(error.message).toBe("SOMETHING_FAILED");
  });

  test("preserves cause for internal logging", () => {
    const cause = new Error("db down");
    const error = new WarblerError("DB_ERROR", 500, "Database error", false, false, { cause });
    expect(error.cause).toBe(cause);
  });

  test("expose and fatal can both be set explicitly", () => {
    const error = new WarblerError("CONN_DEAD", 500, "Connection lost", false, true);
    expect(error.expose).toBe(false);
    expect(error.fatal).toBe(true);
  });
});

describe("convenience errors", () => {
  test.each([
    [BadRequestError, 400, "BadRequestError"],
    [UnauthorizedError, 401, "UnauthorizedError"],
    [ForbiddenError, 403, "ForbiddenError"],
    [NotFoundError, 404, "NotFoundError"],
    [ConflictError, 409, "ConflictError"],
  ] as const)("%s has status %d", (ErrorClass, status, name) => {
    const error = new ErrorClass("SOME_CODE", "Some message");
    expect(error.status).toBe(status);
    expect(error.name).toBe(name);
    expect(error).toBeInstanceOf(WarblerError);
    expect(error.expose).toBe(true);
    expect(error.fatal).toBe(false);
  });
});

describe("normalizeError", () => {
  test("an exposed WarblerError passes through unchanged", () => {
    const original = new NotFoundError("USER_NOT_FOUND", "User not found");
    const normalized = normalizeError(original);
    expect(normalized).toBe(original);
    expect(safeErrorMessage(normalized)).toBe("User not found");
  });

  test("a non-exposed WarblerError hides its message behind the generic one", () => {
    const original = new WarblerError("DB_ERROR", 500, "Postgres connection string leaked here", false);
    const normalized = normalizeError(original);
    expect(normalized).toBe(original);
    expect(normalized.message).toBe("Postgres connection string leaked here");
    expect(safeErrorMessage(normalized)).toBe("Internal Server Error");
    expect(normalized.code).toBe("DB_ERROR");
    expect(normalized.expose).toBe(false);
  });

  test("a plain native Error normalizes to a generic internal error", () => {
    const original = new Error("unexpected failure");
    const normalized = normalizeError(original);
    expect(normalized).toBeInstanceOf(WarblerError);
    expect(normalized.code).toBe("INTERNAL_SERVER_ERROR");
    expect(normalized.status).toBe(500);
    expect(normalized.message).toBe("Internal Server Error");
    expect(normalized.expose).toBe(false);
    expect(normalized.fatal).toBe(false);
    expect(normalized.cause).toBe(original);
    expect(normalized.developerMessage).toBe("unexpected failure");
  });

  test("a non-Error thrown value still normalizes safely", () => {
    const normalized = normalizeError("just a string");
    expect(normalized.code).toBe("INTERNAL_SERVER_ERROR");
    expect(normalized.status).toBe(500);
    expect(normalized.expose).toBe(false);
    expect(normalized.cause).toBe("just a string");
    expect(normalized.developerMessage).toBe("just a string");
  });

  test("fatal propagates through normalization", () => {
    const normalized = normalizeError(new WarblerError("CONN_DEAD", 500, "x", false, true));
    expect(normalized.fatal).toBe(true);
    expect(normalized.severity).toBe("fatal");
  });

  test("cause chains are preserved lazily for diagnostics", () => {
    const root = new Error("root");
    const wrapped = new Error("wrapped", { cause: root });
    const normalized = normalizeError(wrapped);
    expect(errorCauseChain(normalized).map((item) => item.message)).toEqual(["Internal Server Error", "wrapped", "root"]);
  });
});
