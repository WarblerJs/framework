import { describe, expect, test } from "bun:test";
import { describeErrorChain } from "../src/errors";

describe("describeErrorChain", () => {
  test("returns a single Error's message", () => {
    expect(describeErrorChain(new Error("boom"))).toBe("boom");
  });

  test("flattens a .cause chain into one readable message", () => {
    const root = new Error("Invalid allowed origin: 192.168.1.3");
    const middle = new Error('Transport "websocket" failed to start.', { cause: root });
    const outer = new Error("Runtime failed to start from generated application bindings.", { cause: middle });
    expect(describeErrorChain(outer)).toBe(
      'Runtime failed to start from generated application bindings.: Transport "websocket" failed to start.: Invalid allowed origin: 192.168.1.3',
    );
  });

  test("stops at a circular cause instead of looping forever", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(describeErrorChain(a)).toBe("a: b");
  });

  test("falls back for non-Error values", () => {
    expect(describeErrorChain("not an error")).toBe("Unknown failure");
    expect(describeErrorChain(undefined, "custom fallback")).toBe("custom fallback");
  });
});
