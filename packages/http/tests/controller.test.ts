import { describe, expect, test } from "bun:test";
import { Controller, getControllerMetadata } from "../src/controller";
import type { Middleware } from "../src/request";

describe("Controller", () => {
  test("stores immutable normalized metadata", () => {
    @Controller("//users/")
    class UsersController {}
    const metadata = getControllerMetadata(UsersController);
    expect(metadata).toEqual({ prefix: "/users", providers: [], middleware: [] });
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test("accepts object metadata with controller-local providers", () => {
    class UsersService {}
    const middleware: Middleware = (_request, _context, next) => next();
    @Controller({ prefix: "//users/", providers: [UsersService], middleware: [middleware] })
    class UsersController {}
    const metadata = getControllerMetadata(UsersController);
    expect(metadata?.prefix).toBe("/users");
    expect(metadata?.providers).toEqual([UsersService]);
    expect(metadata?.middleware).toEqual([middleware]);
    expect(Object.isFrozen(metadata?.providers)).toBe(true);
    expect(Object.isFrozen(metadata?.middleware)).toBe(true);
  });

  test("normalizes the root prefix to empty", () => {
    @Controller()
    class RootController {}
    expect(getControllerMetadata(RootController)?.prefix).toBe("");
  });
});
