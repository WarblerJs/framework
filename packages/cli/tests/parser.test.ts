import { describe, expect, test } from "bun:test";
import { CLIError, parseCLI } from "../src";

describe("CLI parser", () => {
  test("parses commands, ordered positionals, boolean and value flags immutably", () => {
    const input = ["generate", "graph", "Auth", "--project", "./app", "--dry-run"] as const;
    const parsed = parseCLI(input);
    expect(parsed.command).toBe("generate");
    expect(parsed.args).toEqual(["graph", "Auth"]);
    expect(parsed.flags).toEqual({ project: "./app", "dry-run": true });
    expect(input).toEqual(["generate", "graph", "Auth", "--project", "./app", "--dry-run"]);
    expect(Object.isFrozen(parsed.args)).toBe(true);
  });
  test("supports equals syntax and top-level aliases", () => {
    expect(parseCLI(["build", "--port=3000"]).flags.port).toBe("3000");
    expect(parseCLI(["db:pg", "rollback", "--step=3"]).flags.step).toBe("3");
    expect(parseCLI(["--help"]).command).toBe("help");
    expect(parseCLI(["--version"]).command).toBe("version");
  });
  test("rejects unknown, malformed, duplicate, and conflicting flags", () => {
    for (const args of [
      ["unknown"], ["dev", "--wat"], ["build", "--port"], ["build", "--port", "0"],
      ["dev", "--watch", "--no-watch"], ["build", "--minify", "--no-minify"],
      ["build", "--sourcemap", "--no-sourcemap"], ["build", "--minify=true"], ["build", "--out", "a", "--out", "b"],
    ]) expect(() => parseCLI(args)).toThrow(CLIError);
  });
});
