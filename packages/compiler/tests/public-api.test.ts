import { describe, expect, test } from "bun:test";
import * as compiler from "../src";

describe("public API", () => {
  test("keeps the stable compiler surface through Phase 2", () => {
    expect(Object.keys(compiler).sort()).toEqual([
      "Compiler",
      "CompilerContext",
      "compileApplication",
      "compileProject",
    ]);
  });
});
