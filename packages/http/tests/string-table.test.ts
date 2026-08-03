import { describe, expect, test } from "bun:test";
import {
  RouteFlag,
  StringTableBuilder,
  validateCompiledHttpRouteTable,
} from "../src/compiled";

describe("compiled HTTP contracts", () => {
  test("interns deterministic unique string IDs", () => {
    const builder = new StringTableBuilder();
    expect(builder.intern("GET")).toBe(0);
    expect(builder.intern("/users")).toBe(1);
    expect(builder.intern("GET")).toBe(0);
    expect(builder.build()).toEqual(["GET", "/users"]);
  });

  test("exposes stable bit flags", () => {
    expect((RouteFlag.CSRF_ENABLED | RouteFlag.SSE) & RouteFlag.SSE).toBe(RouteFlag.SSE);
  });

  test("validates compiled IDs before serving", () => {
    const route = {
      methodStringId: 0, pathStringId: 0, controllerStringId: 0, handlerStringId: 0,
      controllerId: 0, handlerId: 0, flags: 0, csrfPolicyId: 0,
      validationPolicyId: 0, middlewareStart: 0, middlewareCount: 0,
    };
    expect(() => validateCompiledHttpRouteTable({ strings: ["x"], routes: [route] }, 1, 1, 0)).not.toThrow();
    expect(() => validateCompiledHttpRouteTable({ strings: [], routes: [route] }, 1, 1, 0)).toThrow("string ID");
  });
});
