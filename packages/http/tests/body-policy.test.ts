import { describe, expect, test } from "bun:test";
import {
  parseJsonBody,
  parseTextBody,
  parseUrlEncodedBody,
  type JsonBodyPolicy,
} from "../src/body";

const JSON_POLICY: JsonBodyPolicy = Object.freeze({
  enabled: true,
  maxSize: 100,
  maxDepth: 3,
  maxKeys: 3,
});

describe("body parsing", () => {
  test("parses bounded JSON and text", async () => {
    expect(await parseJsonBody(new Request("http://x", { method: "POST", body: '{"a":1}' }), JSON_POLICY)).toEqual({ a: 1 });
    expect(await parseTextBody(new Request("http://x", { method: "POST", body: "hello" }), { enabled: true, maxSize: 10 })).toBe("hello");
  });

  test("rejects JSON size, depth, and key overflow", () => {
    expect(parseJsonBody(new Request("http://x", { method: "POST", body: '{"long":"value"}' }), { ...JSON_POLICY, maxSize: 2 })).rejects.toThrow();
    expect(parseJsonBody(new Request("http://x", { method: "POST", body: '{"a":{"b":{"c":1}}}' }), { ...JSON_POLICY, maxDepth: 2 })).rejects.toThrow("depth");
    expect(parseJsonBody(new Request("http://x", { method: "POST", body: '{"a":1,"b":2,"c":3,"d":4}' }), JSON_POLICY)).rejects.toThrow("key");
  });

  test("parses URL encoded data with limits", async () => {
    const result = await parseUrlEncodedBody(
      new Request("http://x", { method: "POST", body: "a=1&a=2" }),
      { enabled: true, maxSize: 20, maxFields: 2, maxFieldSize: 5 },
    );
    expect(result.a).toEqual(["1", "2"]);
  });
});
