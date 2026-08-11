import { describe, expect, test } from "bun:test";
import {
  parseBoolean,
  parseByteSize,
  parseDuration,
  parseHost,
  parsePort,
  env,
} from "../src";
import { parseEnv, parseIp, parseNumber, parseString } from "../src/parser";

describe("configuration parsers", () => {
  test("parses byte sizes with binary multipliers", () => {
    expect(parseByteSize("1b")).toBe(1);
    expect(parseByteSize("1kb")).toBe(1024);
    expect(parseByteSize("20mb")).toBe(20 * 1024 ** 2);
    expect(parseByteSize("2gb")).toBe(2 * 1024 ** 3);
  });

  test("rejects a zero byte size by default (a limit of 0 must be an explicit decision)", () => {
    expect(() => parseByteSize("0b")).toThrow("at least 1 byte");
    expect(() => parseByteSize("0kb")).toThrow();
  });

  test("allows zero only when the caller opts in via minimumBytes", () => {
    expect(parseByteSize("0b", 0)).toBe(0);
    expect(() => parseByteSize("1b", -1)).toThrow("non-negative");
  });

  test.each(["1", "1KB", "-1b", "1.5mb", "", null, undefined, Infinity])(
    "rejects invalid byte size %p",
    (value) => expect(() => parseByteSize(value)).toThrow(),
  );

  test("parses durations with exact units", () => {
    expect(parseDuration("1ms")).toBe(1);
    expect(parseDuration("2s")).toBe(2_000);
    expect(parseDuration("3m")).toBe(180_000);
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  test.each(["1", "1d", "-1ms", "1.2s", NaN, Infinity, null])(
    "rejects invalid duration %p",
    (value) => expect(() => parseDuration(value)).toThrow(),
  );

  test("validates ports", () => {
    expect(parsePort(1)).toBe(1);
    expect(parsePort("65535")).toBe(65_535);
    for (const value of [0, 65_536, -1, 1.5, NaN, Infinity, "01", null]) {
      expect(() => parsePort(value)).toThrow();
    }
  });

  test("validates hosts and IP addresses", () => {
    expect(parseHost("localhost")).toBe("localhost");
    expect(parseHost("api.example.com")).toBe("api.example.com");
    expect(parseIp("127.0.0.1")).toBe("127.0.0.1");
    expect(parseIp("2001:db8::1")).toBe("2001:db8::1");
    for (const value of ["bad host", "-host.test", "256.1.1.1", "2001:::1", null]) {
      expect(() => parseHost(value)).toThrow();
    }
  });

  test("parses strict primitive values", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean(false)).toBe(false);
    expect(parseNumber("-1.25")).toBe(-1.25);
    expect(parseString("é", 2)).toBe("é");
    expect(parseEnv("TOKEN", { TOKEN: "secret" })).toBe("secret");
    expect(() => parseBoolean("TRUE")).toThrow();
    expect(() => parseNumber("1e2")).toThrow();
    expect(() => parseString("é", 1)).toThrow();
    expect(() => parseEnv("token", { token: "secret" })).toThrow();
    expect(() => parseEnv("TOKEN", {})).toThrow();
  });

  test("env helper supports optional, int, and bool config reads", () => {
    const previous = {
      PORT: process.env.PORT,
      ENABLED: process.env.ENABLED,
      EMPTY: process.env.EMPTY,
    };
    try {
      process.env.PORT = "587";
      process.env.ENABLED = "true";
      process.env.EMPTY = "";
      expect(env("MISSING_ENV_HELPER", "fallback")).toBe("fallback");
      expect(env.optional("EMPTY")).toBeUndefined();
      expect(env.int("PORT", 25)).toBe(587);
      expect(env.bool("ENABLED", false)).toBe(true);
      expect(() => env.int("ENABLED", 25)).toThrow();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
