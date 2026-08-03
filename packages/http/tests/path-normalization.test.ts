import { describe, expect, test } from "bun:test";
import { InvalidRouteError } from "../src/errors";
import { joinPaths, normalizePath, validatePathLimits } from "../src/internal";

describe("path normalization", () => {
  test.each([
    ["", "/"],
    ["/", "/"],
    ["users", "/users"],
    ["/users/", "/users"],
    ["//users//:id", "/users/:id"],
  ])("normalizes %s", (input, expected) => expect(normalizePath(input)).toBe(expected));

  test("joins graph controller and route paths", () => {
    expect(joinPaths("/api", "/users", "/:id")).toBe("/api/users/:id");
  });

  test("rejects traversal, null bytes, byte overflow, and parameter overflow", () => {
    expect(() => normalizePath("/a/../b")).toThrow(InvalidRouteError);
    expect(() => normalizePath("/a\0b")).toThrow(InvalidRouteError);
    expect(() => validatePathLimits("/long", 2, 2)).toThrow(InvalidRouteError);
    expect(() => validatePathLimits("/:a/:b", 100, 1)).toThrow(InvalidRouteError);
  });
});
