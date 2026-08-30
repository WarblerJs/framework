import {
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";

import {
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  delegateToProjectCLI,
  resolveDelegationRoot,
} from "../src/local-cli-launcher";

const cleanupRoots: string[] = [];

afterEach(async () => {
  for (
    let index = 0, length = cleanupRoots.length;
    index < length;
    index += 1
  ) {
    await rm(cleanupRoots[index]!, {
      recursive: true,
      force: true,
    });
  }

  cleanupRoots.length = 0;
});

describe("project-local CLI delegation", () => {
  test("resolves explicit project roots", () => {
    expect(
      resolveDelegationRoot(
        ["dev", "--project", "apps/example"],
        "/workspace",
      ),
    ).toBe("/workspace/apps/example");

    expect(
      resolveDelegationRoot(
        ["dev", "--project=/srv/application"],
        "/workspace",
      ),
    ).toBe("/srv/application");

    expect(
      resolveDelegationRoot(
        ["dev"],
        "/workspace",
      ),
    ).toBe("/workspace");
  });

  test("delegates to the project-local CLI and preserves its exit code", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "warbler-local-cli-"),
    );

    cleanupRoots.push(root);

    const packageRoot = join(
      root,
      "node_modules",
      "@warblerjs",
      "cli",
    );

    await mkdir(packageRoot, {
      recursive: true,
    });

    await Bun.write(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@warblerjs/cli",
        version: "9.9.9",
        type: "module",
        exports: {
          "./bin": "./bin.ts",
        },
      }),
    );

    await Bun.write(
      join(packageRoot, "bin.ts"),
      `
await Bun.write(
  process.cwd() + "/delegated.json",
  JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    marker: process.env.WARBLER_LOCAL_CLI,
  }),
);

process.exit(7);
`,
    );

    const exitCode = await delegateToProjectCLI(
      ["dev", "--no-color"],
      "/global/warbler/bin.ts",
      root,
    );

    expect(exitCode).toBe(7);

    const result = await Bun.file(
      join(root, "delegated.json"),
    ).json() as {
      readonly argv: readonly string[];
      readonly cwd: string;
      readonly marker?: string;
    };

    expect(result).toEqual({
      argv: ["dev", "--no-color"],
      cwd: root,
      marker: "1",
    });
  });

  test("returns undefined when no project-local CLI exists", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "warbler-no-local-cli-"),
    );

    cleanupRoots.push(root);

    expect(
      await delegateToProjectCLI(
        ["dev"],
        "/global/warbler/bin.ts",
        root,
      ),
    ).toBeUndefined();
  });
});