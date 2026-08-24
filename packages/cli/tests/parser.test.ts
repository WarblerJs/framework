import { describe, expect, test } from "bun:test";
import { CLIError, parseCLI } from "../src";

describe("CLI parser", () => {
  test("parses commands, ordered positionals, boolean and value flags immutably", () => {
    const input = ["make:graph", "Auth", "--project", "./app", "--dry-run"] as const;
    const parsed = parseCLI(input);
    expect(parsed.command).toBe("make:graph");
    expect(parsed.args).toEqual(["Auth"]);
    expect(parsed.flags).toEqual({ project: "./app", "dry-run": true });
    expect(input).toEqual(["make:graph", "Auth", "--project", "./app", "--dry-run"]);
    expect(Object.isFrozen(parsed.args)).toBe(true);
  });
  test("supports equals syntax and top-level aliases", () => {
    expect(parseCLI(["build", "--port=3000"]).flags.port).toBe("3000");
    expect(parseCLI(["make:graph", "users", "-a", "hexagonal", "-t", "http,socket"]).flags).toEqual({ architecture: "hexagonal", transport: "http,socket" });
    expect(parseCLI(["make:graph", "users", "--architecture=clean", "--transport=socket"]).flags).toEqual({ architecture: "clean", transport: "socket" });
    expect(parseCLI(["db:pg", "rollback", "--step=3"]).flags.step).toBe("3");
    expect(parseCLI(["db:pg", "seed:run", "--only", "users"]).flags.only).toBe("users");
    expect(parseCLI(["db:pg", "migration", "create:table:logs", "--no-soft-delete"]).flags["no-soft-delete"]).toBe(true);
    expect(parseCLI(["--help"]).command).toBe("help");
    expect(parseCLI(["--version"]).command).toBe("version");
  });
  test("rejects unknown, malformed, duplicate, and conflicting flags", () => {
    for (const args of [
      ["unknown"], ["dev", "--wat"], ["build", "--port"], ["build", "--port", "0"],
      ["dev", "--watch", "--no-watch"], ["build", "--minify", "--no-minify"],
      ["build", "--sourcemap", "--no-sourcemap"], ["build", "--minify=true"], ["build", "--out", "a", "--out", "b"],
      ["make:graph", "users", "-a"], ["make:graph", "users", "-x", "minimal"],
    ]) expect(() => parseCLI(args)).toThrow(CLIError);
  });
});
