import { describe, expect, test } from "bun:test";
import { Transport } from "../src";

describe("Transport", () => {
  test("exposes stable transport identifiers", () => {
    expect(Transport.HTTP).toBe("http");
    expect(Transport.WEBSOCKET).toBe("websocket");
  });
});
