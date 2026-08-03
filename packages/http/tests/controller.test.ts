import { describe, expect, test } from "bun:test";
import { Controller, getControllerMetadata } from "../src/controller";

describe("Controller", () => {
  test("stores immutable normalized metadata", () => {
    @Controller("//users/")
    class UsersController {}
    const metadata = getControllerMetadata(UsersController);
    expect(metadata).toEqual({ prefix: "/users" });
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test("normalizes the root prefix to empty", () => {
    @Controller()
    class RootController {}
    expect(getControllerMetadata(RootController)?.prefix).toBe("");
  });
});
