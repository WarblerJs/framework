import { describe, expect, test } from "bun:test";
import { Controller, getControllerMetadata } from "../src/controller";

describe("Controller", () => {
  test("stores immutable normalized metadata", () => {
    @Controller("//users/")
    class UsersController {}
    const metadata = getControllerMetadata(UsersController);
    expect(metadata).toEqual({ prefix: "/users", providers: [] });
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test("accepts object metadata with controller-local providers", () => {
    class UsersService {}
    @Controller({ prefix: "//users/", providers: [UsersService] })
    class UsersController {}
    const metadata = getControllerMetadata(UsersController);
    expect(metadata?.prefix).toBe("/users");
    expect(metadata?.providers).toEqual([UsersService]);
    expect(Object.isFrozen(metadata?.providers)).toBe(true);
  });

  test("normalizes the root prefix to empty", () => {
    @Controller()
    class RootController {}
    expect(getControllerMetadata(RootController)?.prefix).toBe("");
  });
});
