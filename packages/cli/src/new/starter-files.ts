import { CLI_VERSION } from "../version";
import { STARTER_CONFIG_FILES, STARTER_ENV_EXAMPLE } from "./starter-configs.generated";
import { STARTER_PACKAGE_VERSIONS as versions, type StarterPackageName } from "./starter-package-versions.generated";

export interface StarterFile {
  readonly path: string;
  readonly content: string;
}

export interface StarterEnvSecrets {
  readonly cryptoKey: string;
  readonly hmacKey: string;
}

export interface StarterFileInput {
  readonly name: string;
  readonly secrets: StarterEnvSecrets;
}

const comparePath = (left: StarterFile, right: StarterFile): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

export function starterDependencyRange(version: string): string {
  return version.includes("-") ? version : `^${version}`;
}

export function generateStarterEnvSecrets(): StarterEnvSecrets {
  return Object.freeze({
    cryptoKey: randomBase64Url32Bytes(),
    hmacKey: randomBase64Url32Bytes(),
  });
}

/** Creates the deterministic production starter file list for `warbler new`. */
export function createStarterFiles(input: StarterFileInput): readonly StarterFile[] {
  const templateFiles = [
    file(".env", envFile(input)),
    file(".env.example", STARTER_ENV_EXAMPLE),
    file(".gitignore", rootGitignore()),
    file("README.md", readmeFile(input.name)),
    file("database/warbler/README.md", databaseReadme()),
    file("database/warbler/pg/.gitkeep", ""),
    file("package.json", packageJson(input.name)),
    file("public/.gitkeep", ""),
    file("resources/css/app.css", cssEntry()),
    file("resources/i18n/ar/.gitkeep", ""),
    file("resources/i18n/en/messages.json", `${JSON.stringify({ hello: "Hello from Warbler" }, null, 2)}\n`),
    file("resources/i18n/es/.gitkeep", ""),
    file("resources/i18n/fr/.gitkeep", ""),
    file("resources/js/app.ts", browserEntry()),
    file("resources/views/.gitkeep", ""),
    file("src/graphs/home/home.graph.ts", homeGraph()),
    file("src/graphs/home/presentation/http/handlers/home.handlers.ts", homeHandlers()),
    file("src/main.ts", mainSource()),
    file("src/shared/.gitkeep", ""),
    file("storage/.gitignore", storageGitignore()),
    file("storage/logs/.gitkeep", ""),
    file("tests/app.test.ts", appTest()),
    file("tsconfig.json", tsconfig()),
  ];

  assertNoInlineConfigTemplates(templateFiles);
  const files = [
    ...templateFiles,
    ...STARTER_CONFIG_FILES.map((item) => file(item.path, item.content)),
  ].sort(comparePath);

  assertUniquePaths(files);
  return Object.freeze(files);
}

function file(path: string, content: string): StarterFile {
  assertSafeRelativePath(path);
  return Object.freeze({ path, content });
}

function assertSafeRelativePath(path: string): void {
  if (path.length === 0 || path.includes("\0") || path.startsWith("/") || path.includes("\\")) {
    throw new TypeError(`Starter path is not project-relative: ${path}`);
  }
  if (path.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new TypeError(`Starter path contains an unsafe segment: ${path}`);
  }
}

function assertUniquePaths(files: readonly StarterFile[]): void {
  const seen = new Set<string>();
  for (const item of files) {
    if (seen.has(item.path)) throw new TypeError(`Starter path is duplicated: ${item.path}`);
    seen.add(item.path);
  }
}

function assertNoInlineConfigTemplates(files: readonly StarterFile[]): void {
  for (const item of files) {
    if (item.path === "src/config" || item.path.startsWith("src/config/")) {
      throw new TypeError(`Starter config file must come from STARTER_CONFIG_FILES: ${item.path}`);
    }
  }
}

function starterPackage(packageName: StarterPackageName): string {
  return starterDependencyRange(versions[packageName]);
}

function packageJson(name: string): string {
  return `${JSON.stringify({
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "warbler dev",
      build: "warbler build",
      start: "warbler start",
      doctor: "warbler doctor",
      inspect: "warbler inspect",
      test: "bun test",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@warblerjs/config": starterPackage("config"),
      "@warblerjs/crypto": starterPackage("crypto"),
      "@warblerjs/database": starterPackage("database"),
      "@warblerjs/email": starterPackage("email"),
      "@warblerjs/framework": starterPackage("framework"),
      "@warblerjs/frontend": starterPackage("frontend"),
      "@warblerjs/http": starterPackage("http"),
      "@warblerjs/i18n": starterPackage("i18n"),
      "@warblerjs/runtime": starterPackage("runtime"),
      "@warblerjs/view": starterPackage("view"),
      "@warblerjs/websocket": starterPackage("websocket"),
    },
    devDependencies: {
      "@warblerjs/cli": starterDependencyRange(CLI_VERSION),
      "@types/bun": "latest",
      typescript: "^5.9.2",
    },
    engines: {
      bun: ">=1.3.0",
    },
  }, null, 2)}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      allowImportingTsExtensions: true,
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      target: "ESNext",
      module: "Preserve",
      moduleDetection: "force",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["bun"],
    },
    include: [
      "src/**/*.ts",
      "resources/**/*.ts",
      "tests/**/*.ts",
      "database/**/*.ts",
      ".warbler/generated/context.generated.d.ts",
    ],
  }, null, 2)}\n`;
}

function rootGitignore(): string {
  return "node_modules/\ndist/\n.warbler/\n.env\n.env.*\n!.env.example\n";
}

function storageGitignore(): string {
  return "*\n!.gitignore\n!logs/\nlogs/*\n!logs/.gitkeep\n";
}

function envFile(input: StarterFileInput): string {
  return applyEnvOverrides(STARTER_ENV_EXAMPLE, Object.freeze({
    APP_HOST: "127.0.0.1",
    DB_DATABASE: databaseName(input.name),
    APP_CRYPTO_KEY: input.secrets.cryptoKey,
    APP_HMAC_KEY: input.secrets.hmacKey,
  }));
}

function databaseName(name: string): string {
  return `${name.replaceAll("-", "_")}_development`;
}

function applyEnvOverrides(source: string, overrides: Readonly<Record<string, string>>): string {
  return `${source.replace(/\n$/u, "").split("\n").map((line) => {
    const parsed = parseEnvAssignment(line);
    if (parsed === undefined) return line;
    const value = overrides[parsed.key];
    return value === undefined ? line : `${parsed.prefix}${parsed.key}${parsed.beforeEquals}=${value}`;
  }).join("\n")}\n`;
}

function parseEnvAssignment(line: string): Readonly<{
  readonly prefix: string;
  readonly key: string;
  readonly beforeEquals: string;
}> | undefined {
  const match = /^(\s*(?:export\s+)?)([A-Z_][A-Z0-9_]*)(\s*)=/u.exec(line);
  if (match === null) return undefined;
  const prefix = match[1];
  const key = match[2];
  const beforeEquals = match[3];
  if (prefix === undefined || key === undefined || beforeEquals === undefined) return undefined;
  return Object.freeze({ prefix, key, beforeEquals });
}

function randomBase64Url32Bytes(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function mainSource(): string {
  return `import { createApp, Transport } from "@warblerjs/framework";

export default createApp({
  transports: [
    Transport.HTTP,
  ],

  graphs: "src/graphs/**/*.graph.ts",
});
`;
}

function homeGraph(): string {
  return `import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/home.handlers";

export default defineHttpGraph({
  prefix: "/",
  middlewares: [],
  providers: [],
  routes: {
    "GET /": {
      name: "home.index",
      handler: handlers.index,
    },
  },
});
`;
}

function homeHandlers(): string {
  return `import { defineHandler, JsonRes } from "@warblerjs/framework";

const message = "Warbler";

export const index = defineHandler({
  run: () => JsonRes({ message }),
});
`;
}

function browserEntry(): string {
  return `/// <reference lib="dom" />
import { ready } from "@warblerjs/frontend";

ready(() => {
  document.documentElement.dataset.warbler = "ready";
});
`;
}

function cssEntry(): string {
  return `:root {
  color-scheme: light;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
}
`;
}

function databaseReadme(): string {
  return `# Warbler Database Artifacts

\`database/warbler/\` is managed by Warbler tooling.

\`database/warbler/pg/\` is reserved for PostgreSQL artifacts managed by \`warbler db:pg\` commands, including generated client files, migration files, and seed files.

Do not manually edit generated artifacts unless the Warbler documentation explicitly instructs you to. Generated database artifacts may be committed when your project convention requires checked-in database output.
`;
}

function readmeFile(name: string): string {
  return `# ${name}

A Bun-native Warbler application.

## Commands

\`\`\`sh
bun install
warbler doctor
warbler dev
warbler build --minify --sourcemap
warbler start
\`\`\`
`;
}

function appTest(): string {
  return `import { describe, expect, test } from "bun:test";

import { index } from "../src/graphs/home/presentation/http/handlers/home.handlers";

describe("starter app", () => {
  test("home handler returns the default JSON response", async () => {
    const response = await index.run({});
    expect(response).toBeInstanceOf(Response);
    expect(await response.json()).toEqual({ message: "Warbler" });
  });
});
`;
}
