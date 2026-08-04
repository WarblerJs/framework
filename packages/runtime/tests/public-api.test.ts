import { describe, expect, test } from "bun:test";
import * as runtime from "../src";

describe("Runtime public API", () => {
  test("does not expose compiler, AST, or decorator analysis", () => {
    expect(Object.keys(runtime)).not.toContain("Compiler");
    expect(Object.keys(runtime)).not.toContain("typescript");
    expect(Object.keys(runtime)).not.toContain("getProviderMetadata");
    expect(runtime.RuntimeState.CREATED).toBe("created");
    expect(runtime.bootstrapApplication).toBeTypeOf("function");
  });
});
