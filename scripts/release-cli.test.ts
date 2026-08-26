import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  CliReleaseError,
  parseCliReleaseArgs,
  runCliRelease,
  type CommandRunner,
  type GenerationStep,
} from "./release-cli";
import type { NpmClient, PublishedPackageMetadata } from "./release/types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

describe("release:cli", () => {
  test("preserves explicit check, dry-run, and publish intent", () => {
    expect(() => parseCliReleaseArgs([])).toThrow(CliReleaseError);
    expect(() => parseCliReleaseArgs(["--check", "--publish"])).toThrow(CliReleaseError);
    expect(parseCliReleaseArgs(["--dry-run"]).mode).toBe("check");
    expect(parseCliReleaseArgs(["--check"]).mode).toBe("check");
    expect(parseCliReleaseArgs(["--publish"]).mode).toBe("publish");
  });

  test("dirty worktree aborts before generators, pack, metadata, or publish", async () => {
    const harness = await createHarness({ gitStatuses: [" M package.json\n"] });
    await expect(harness.run()).rejects.toThrow("clean git working tree");
    expect(harness.events).toEqual(["git"]);
    expect(harness.npm.metadataCalls).toBe(0);
    expect(harness.published).toEqual([]);
  });

  test("generated starter config changes abort release", async () => {
    const harness = await createHarness({ configGenerateChanged: true });
    await expect(harness.run()).rejects.toThrow("generated starter artifacts changed");
    expect(harness.events).toEqual(["git", "generate-config"]);
    expect(harness.npm.metadataCalls).toBe(0);
  });

  test("generated starter version changes abort release", async () => {
    const harness = await createHarness({ versionGenerateChanged: true });
    await expect(harness.run()).rejects.toThrow("generated starter artifacts changed");
    expect(harness.events).toEqual(["git", "generate-config", "generate-version"]);
    expect(harness.npm.metadataCalls).toBe(0);
  });

  test("config check failure aborts", async () => {
    const harness = await createHarness({ configCheckError: new Error("config check failed") });
    await expect(harness.run()).rejects.toThrow("config check failed");
    expect(harness.events).toEqual(["git", "generate-config", "generate-version", "git", "check-config"]);
    expect(harness.commands).not.toContain("bun run typecheck");
  });

  test("version check failure aborts", async () => {
    const harness = await createHarness({ versionCheckError: new Error("version check failed") });
    await expect(harness.run()).rejects.toThrow("version check failed");
    expect(harness.events).toEqual(["git", "generate-config", "generate-version", "git", "check-config", "check-version"]);
    expect(harness.commands).not.toContain("bun run typecheck");
  });

  test("CLI typecheck failure aborts", async () => {
    const harness = await createHarness({
      commandResults: { "bun run typecheck": commandResult("", "typecheck broke", 2) },
    });
    await expect(harness.run()).rejects.toMatchObject({ exitCode: 2 });
    expect(harness.events).toContain("bun run typecheck");
    expect(harness.commands).not.toContain("bun test packages/cli/tests");
    expect(harness.npm.metadataCalls).toBe(0);
  });

  test("CLI test failure aborts", async () => {
    const harness = await createHarness({
      commandResults: { "bun test packages/cli/tests": commandResult("", "tests broke", 3) },
    });
    await expect(harness.run()).rejects.toMatchObject({ exitCode: 3 });
    expect(harness.events).toContain("bun run typecheck");
    expect(harness.events).toContain("bun test packages/cli/tests");
    expect(harness.commands).not.toContain("npm pack --dry-run --json");
    expect(harness.npm.metadataCalls).toBe(0);
  });

  test("npm pack failure aborts", async () => {
    const harness = await createHarness({
      commandResults: { "npm pack --dry-run --json": commandResult("", "pack broke", 4) },
    });
    await expect(harness.run()).rejects.toThrow("npm pack --dry-run failed");
    expect(harness.npm.metadataCalls).toBe(0);
    expect(harness.published).toEqual([]);
  });

  test("pack missing starter-configs.generated.ts aborts", async () => {
    const harness = await createHarness({
      packFiles: ["src/new/starter-package-versions.generated.ts"],
    });
    await expect(harness.run()).rejects.toThrow("starter-configs.generated.ts");
    expect(harness.npm.metadataCalls).toBe(0);
  });

  test("pack missing starter-package-versions.generated.ts aborts", async () => {
    const harness = await createHarness({
      packFiles: ["src/new/starter-configs.generated.ts"],
    });
    await expect(harness.run()).rejects.toThrow("starter-package-versions.generated.ts");
    expect(harness.npm.metadataCalls).toBe(0);
  });

  test("already-published npm version aborts", async () => {
    const harness = await createHarness({ metadataExists: true });
    await expect(harness.run()).rejects.toThrow("@warblerjs/cli@0.2.0 is already published");
    expect(harness.npm.metadataCalls).toBe(1);
    expect(harness.npm.whoamiCalls).toBe(0);
    expect(harness.published).toEqual([]);
  });

  test("missing npm authentication aborts publish mode", async () => {
    const harness = await createHarness({ mode: "publish", whoami: false });
    await expect(harness.run()).rejects.toThrow("npm authentication is required");
    expect(harness.npm.metadataCalls).toBe(1);
    expect(harness.npm.whoamiCalls).toBe(1);
    expect(harness.events).not.toContain("npm pack --json --pack-destination");
    expect(harness.published).toEqual([]);
  });

  test("check and dry-run modes never call publish", async () => {
    const check = await createHarness({ mode: "check" });
    await check.run();
    const dryRun = await createHarness({ mode: parseCliReleaseArgs(["--dry-run"]).mode });
    await dryRun.run();
    expect(check.published).toEqual([]);
    expect(dryRun.published).toEqual([]);
    expect(check.npm.whoamiCalls).toBe(0);
    expect(dryRun.npm.whoamiCalls).toBe(0);
  });

  test("publish is called exactly once only after every gate succeeds", async () => {
    const harness = await createHarness({ mode: "publish" });
    await harness.run();
    expect(harness.published).toHaveLength(1);
    expect(harness.events.at(-1)).toBe("publish");
    expect(harness.events).toEqual([
      "git",
      "generate-config",
      "generate-version",
      "git",
      "check-config",
      "check-version",
      "bun run typecheck",
      "bun test packages/cli/tests",
      "npm pack --dry-run --json",
      "metadata",
      "whoami",
      "npm pack --json --pack-destination",
      "publish",
    ]);
    expect(harness.packDestination).toBeDefined();
    expect(await pathExists(harness.packDestination!)).toBe(false);
  });

  test("temporary tarball directory is removed when publish fails", async () => {
    const harness = await createHarness({ mode: "publish", publishError: new Error("publish failed") });
    await expect(harness.run()).rejects.toThrow("publish failed");
    expect(harness.packDestination).toBeDefined();
    expect(await pathExists(harness.packDestination!)).toBe(false);
  });

  test("diagnostics never include npm tokens or secret environment values", async () => {
    const previousToken = process.env.NPM_TOKEN;
    const previousSecret = process.env.APP_CRYPTO_KEY;
    process.env.NPM_TOKEN = "npm_supersecrettoken";
    process.env.APP_CRYPTO_KEY = "super-secret-crypto-value";
    try {
      const harness = await createHarness({
        commandResults: {
          "npm pack --dry-run --json": commandResult(
            "",
            "pack failed with npm_supersecrettoken and super-secret-crypto-value",
            1,
          ),
        },
      });
      let message = "";
      try {
        await harness.run();
      } catch (cause) {
        message = cause instanceof Error ? cause.message : String(cause);
      }
      expect(message).toContain("[redacted]");
      expect(message).not.toContain("npm_supersecrettoken");
      expect(message).not.toContain("super-secret-crypto-value");
    } finally {
      restoreEnv("NPM_TOKEN", previousToken);
      restoreEnv("APP_CRYPTO_KEY", previousSecret);
    }
  });
});

interface HarnessOptions {
  readonly mode?: "check" | "publish";
  readonly gitStatuses?: readonly string[];
  readonly configGenerateChanged?: boolean;
  readonly versionGenerateChanged?: boolean;
  readonly configCheckError?: Error;
  readonly versionCheckError?: Error;
  readonly commandResults?: Readonly<Record<string, CommandResult>>;
  readonly packFiles?: readonly string[];
  readonly metadataExists?: boolean;
  readonly whoami?: boolean;
  readonly publishError?: Error;
}

interface Harness {
  readonly root: string;
  readonly commands: readonly string[];
  readonly events: readonly string[];
  readonly npm: FakeNpmClient;
  readonly published: readonly string[];
  readonly packDestination: string | undefined;
  run(): Promise<void>;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface FakeNpmClient extends NpmClient {
  readonly metadataCalls: number;
  readonly whoamiCalls: number;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await fixtureRoot();
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const commands: string[] = [];
  const events: string[] = [];
  const published: string[] = [];
  let packDestination: string | undefined;
  let gitIndex = 0;
  let metadataCalls = 0;
  let whoamiCalls = 0;
  const gitStatuses = options.gitStatuses ?? ["", ""];

  const runCommand: CommandRunner = async (command, args) => {
    const line = [command, ...args].join(" ");
    commands.push(line);
    if (command === "git") {
      events.push("git");
      const stdout = gitStatuses[Math.min(gitIndex, gitStatuses.length - 1)] ?? "";
      gitIndex++;
      return commandResult(stdout);
    }
    if (command === "bun") {
      events.push(line);
      return options.commandResults?.[line] ?? commandResult("");
    }
    if (command === "npm" && args.includes("--dry-run")) {
      events.push(line);
      const configured = options.commandResults?.[line];
      if (configured !== undefined) return configured;
      return commandResult(JSON.stringify([{
        files: (options.packFiles ?? [
          "src/new/starter-configs.generated.ts",
          "src/new/starter-package-versions.generated.ts",
        ]).map((path) => ({ path })),
      }]));
    }
    if (command === "npm" && args[0] === "pack") {
      events.push("npm pack --json --pack-destination");
      packDestination = valueAfter(args, "--pack-destination");
      const configured = options.commandResults?.[line];
      if (configured !== undefined) return configured;
      return commandResult(JSON.stringify([{ filename: "warblerjs-cli-0.2.0.tgz" }]));
    }
    return commandResult("", `Unexpected command: ${line}`, 1);
  };

  const npm: FakeNpmClient = {
    registry: "https://registry.npmjs.org/",
    get metadataCalls() { return metadataCalls; },
    get whoamiCalls() { return whoamiCalls; },
    metadata(_name: string, _version: string): Promise<PublishedPackageMetadata> {
      events.push("metadata");
      metadataCalls++;
      return Promise.resolve(Object.freeze({ exists: options.metadataExists === true }));
    },
    versions(): Promise<readonly string[]> {
      return Promise.resolve(Object.freeze([]));
    },
    whoami(): Promise<boolean> {
      events.push("whoami");
      whoamiCalls++;
      return Promise.resolve(options.whoami !== false);
    },
    publish(): Promise<void> {
      throw new Error("real publish boundary must not be used in tests");
    },
  };

  const generateStarterConfigs: GenerationStep = (input) => {
    events.push(input.check === true ? "check-config" : "generate-config");
    if (input.check === true && options.configCheckError !== undefined) return Promise.reject(options.configCheckError);
    return Promise.resolve(Object.freeze({ changed: input.check === true ? false : options.configGenerateChanged === true }));
  };

  const generateStarterPackageVersions: GenerationStep = (input) => {
    events.push(input.check === true ? "check-version" : "generate-version");
    if (input.check === true && options.versionCheckError !== undefined) return Promise.reject(options.versionCheckError);
    return Promise.resolve(Object.freeze({ changed: input.check === true ? false : options.versionGenerateChanged === true }));
  };

  return {
    root,
    commands,
    events,
    npm,
    published,
    get packDestination() { return packDestination; },
    run() {
      return runCliRelease(
        { root, mode: options.mode ?? "check" },
        {
          npm,
          runCommand,
          generateStarterConfigs,
          generateStarterPackageVersions,
          publishTarball(_npm, tarball, tag) {
            events.push("publish");
            published.push(`${tarball}:${tag}`);
            if (options.publishError !== undefined) return Promise.reject(options.publishError);
            return Promise.resolve();
          },
        },
      );
    },
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-cli-release-"));
  await writeJson(join(root, "package.json"), { name: "warbler", private: true });
  await writeJson(join(root, "packages/cli/package.json"), { name: "@warblerjs/cli", version: "0.2.0" });
  return root;
}

function commandResult(stdout: string, stderr = "", exitCode = 0): CommandResult {
  return Object.freeze({ exitCode, stdout, stderr });
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
