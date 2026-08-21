import { describe, expect, test } from "bun:test";
import { httpConfig } from "../../../playground/src/config/transports/http.config";
import { normalizeHttpConfig } from "../src/config";

describe("HTTP config", () => {
  test("normalizes playground config to frozen numeric limits", () => {
    const config = normalizeHttpConfig(httpConfig);
    expect(config.maxRequestBodySize).toBe(20 * 1024 ** 2);
    expect(config.body.json.maxSize).toBe(1024 ** 2);
    expect(config.idleTimeoutSeconds).toBe(30);
    expect(Object.isFrozen(config.body.multipart)).toBe(true);
  });

  test.each([null, NaN, Infinity, 0, -1, "bad"])("rejects invalid body size %p", (maxSize) => {
    expect(() => normalizeHttpConfig({ body: { maxSize } })).toThrow();
  });
});
