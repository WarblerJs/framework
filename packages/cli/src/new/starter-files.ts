import { CLI_VERSION } from "../version";
import { STARTER_PACKAGE_VERSIONS as versions, type StarterPackageName } from "./starter-package-versions.generated";

export interface StarterFile {
  readonly path: string;
  readonly content: string;
}

export interface StarterFileInput {
  readonly name: string;
}

const comparePath = (left: StarterFile, right: StarterFile): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

export function starterDependencyRange(version: string): string {
  return version.includes("-") ? version : `^${version}`;
}

/** Creates the deterministic production starter file list for `warbler new`. */
export function createStarterFiles(input: StarterFileInput): readonly StarterFile[] {
  const files = [
    file(".env", envFile(input.name)),
    file(".env.example", envExampleFile(input.name)),
    file(".gitignore", rootGitignore()),
    file("README.md", readmeFile(input.name)),
    file("database/warbler/README.md", databaseReadme()),
    file("database/warbler/pg/.gitkeep", ""),
    file("package.json", packageJson(input.name)),
    file("public/.gitkeep", ""),
    file("resources/css/app.css", cssEntry()),
    file("resources/i18n/en/messages.json", `${JSON.stringify({ hello: "Hello from Warbler" }, null, 2)}\n`),
    file("resources/js/app.ts", browserEntry()),
    file("resources/views/.gitkeep", ""),
    file("src/config/crypto.config.ts", cryptoConfig()),
    file("src/config/database.config.ts", databaseConfig(input.name)),
    file("src/config/i18n.config.ts", i18nConfig()),
    file("src/config/logging.config.ts", loggingConfig()),
    file("src/config/mail.config.ts", mailConfig()),
    file("src/config/profiling.config.ts", profilingConfig()),
    file("src/config/runtime.config.ts", runtimeConfig()),
    file("src/config/transports/http.config.ts", httpConfig()),
    file("src/config/view.ts", viewConfig()),
    file("src/graphs/home/home.graph.ts", homeGraph()),
    file("src/graphs/home/presentation/http/handlers/home.handlers.ts", homeHandlers()),
    file("src/main.ts", mainSource()),
    file("src/shared/.gitkeep", ""),
    file("storage/.gitignore", storageGitignore()),
    file("storage/logs/.gitkeep", ""),
    file("tests/app.test.ts", appTest()),
    file("tsconfig.json", tsconfig()),
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

function envFile(name: string): string {
  const database = databaseName(name);
  return `APP_ENV=development
APP_HOST=0.0.0.0

# Database commands use these values only when you run warbler db:pg commands.
# DATABASE_URL=
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=${database}
DB_USERNAME=warbler
# DB_PASSWORD=
DB_LOG_QUERIES=false
DB_SSL=false
DB_POOL_MAX=10
DB_IDLE_TIMEOUT=30
DB_CONNECTION_TIMEOUT=10

WARBLER_HTTP_PROFILING=false
WARBLER_HTTP_PROFILING_SUMMARY=true
`;
}

function envExampleFile(name: string): string {
  const database = databaseName(name);
  return `APP_ENV=development
APP_HOST=0.0.0.0

# DATABASE_URL=postgres://warbler:change-me@localhost:5432/${database}
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=${database}
DB_USERNAME=warbler
DB_PASSWORD=
DB_LOG_QUERIES=false
DB_SSL=false
DB_POOL_MAX=10
DB_IDLE_TIMEOUT=30
DB_CONNECTION_TIMEOUT=10

MAIL_FROM_ADDRESS=noreply@example.com
MAIL_FROM_NAME=Warbler

WARBLER_HTTP_PROFILING=false
WARBLER_HTTP_PROFILING_SUMMARY=true
`;
}

function databaseName(name: string): string {
  return `${name.replaceAll("-", "_")}_development`;
}

function mainSource(): string {
  return `import { createApp, Transport } from "@warblerjs/framework";

export default createApp({
  transports: [Transport.HTTP],
  graphs: "src/graphs/**/*.graph.ts",
});
`;
}

function runtimeConfig(): string {
  return `import { envString } from "@warblerjs/config";

export const runtimeConfig = {
  network: {
    host: envString("APP_HOST", "0.0.0.0"),
    bindInterface: undefined,
  },
  transports: {
    http: { enabled: true, port: 3000 },
    websocket: { enabled: false },
    tcp: { enabled: false },
    udp: { enabled: false },
    mcp: { enabled: false },
    webrtc: { enabled: false },
  },
  telemetry: {
    metrics: { enabled: false, host: envString("APP_HOST", "0.0.0.0"), port: 9090, path: "/metrics" },
    healthCheck: { enabled: false, host: envString("APP_HOST", "0.0.0.0"), port: 9091, path: "/health" },
  },
} as const;

export default runtimeConfig;
`;
}

function httpConfig(): string {
  return `import { envString } from "@warblerjs/config";
  
  export const httpConfig = {
  host: envString("APP_HOST", "0.0.0.0"),
  port: 3000,
  allowedHosts: [envString("APP_HOST", "0.0.0.0"), "localhost"],
  request: {
    body: {
      enabled: true,
      maxSize: "10mb",
      unknownContentType: "reject",
      json: { enabled: true, maxSize: "1mb", maxDepth: 12, maxKeys: 500 },
      text: { enabled: true, maxSize: "256kb" },
      urlEncoded: { enabled: true, maxSize: "256kb", maxFields: 100, maxFieldSize: "16kb" },
      multipart: {
        enabled: true,
        maxSize: "2mb",
        maxFiles: 4,
        maxFileSize: "1mb",
        maxFields: 32,
        maxFieldSize: "16kb",
        allowedMimeTypes: ["image/png", "application/pdf", "application/zip"],
      },
    },
    headers: { maxCount: 100, maxSize: "16kb", maxNameSize: "256b", maxValueSize: "8kb" },
    query: { maxParameters: 100, maxDepth: 8 },
    cookies: { maxCount: 50, maxSize: "8kb" },
    path: { maxSize: "8kb", maxParameters: 32 },
    timeouts: { headers: 5_000, body: 30_000, request: 60_000, idle: 30_000 },
  },
  csrf: {
    enabled: false,
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    headerName: "x-csrf-token",
    cookieName: "__Host-warbler-csrf",
    fieldName: "_csrf",
    sources: ["header", "form"],
    strictSources: true,
  },
  security: {
    enabled: true,
    contentSecurityPolicy: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    frameOptions: "DENY",
  },
  static: {
    enabled: false,
    root: "public",
    prefix: "/",
    indexFiles: ["index.html"],
    exposeDotfiles: false,
    exposeSourceMaps: false,
    cacheControl: { enabled: true, immutableAssets: true },
  },
  rateLimit: { trustProxy: false, trustedProxies: [] },
} as const;
`;
}

function cryptoConfig(): string {
  return `import type { CryptoConfigInput } from "@warblerjs/crypto";

const cryptoConfig: CryptoConfigInput = {
  password: {
    algorithm: "argon2id",
  },
  hashing: {
    algorithm: "sha256",
    output: "hex",
  },
  encoding: {
    output: "base64url",
  },
  random: {
    maxBytes: 1024 * 1024,
    tokenBytes: 32,
  },
};

export default cryptoConfig;
`;
}

function databaseConfig(name: string): string {
  return `import { env, envBoolean, envNumber, envString } from "@warblerjs/config";
import type { DatabaseProjectConfig } from "@warblerjs/database";

export const databaseConfig = {
  pg: {
    log: envBoolean("DB_LOG_QUERIES", false),
    connection: {
      adapter: "postgres",
      url: env.optional("DATABASE_URL"),
      hostname: envString("DB_HOST", "localhost"),
      port: envNumber("DB_PORT", 5432),
      database: envString("DB_DATABASE", "${databaseName(name)}"),
      username: envString("DB_USERNAME", "warbler"),
      password: env.optional("DB_PASSWORD"),
      ssl: envBoolean("DB_SSL", false),
      max: envNumber("DB_POOL_MAX", 10),
      idleTimeout: envNumber("DB_IDLE_TIMEOUT", 30),
      connectionTimeout: envNumber("DB_CONNECTION_TIMEOUT", 10),
    },
    migrations: {
      table: "_wrbls_migrations",
      seedTable: "_warbler_seeds",
      generated: "database/warbler/pg/generated",
      path: "database/warbler/pg/migrations",
      seeds: "database/warbler/pg/seeds",
      softDelete: true,
    },
  } satisfies DatabaseProjectConfig,
} as const;
`;
}

function i18nConfig(): string {
  return `import type { I18nConfigInput } from "@warblerjs/i18n";

const i18nConfig = {
  enabled: true,
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: ["en"],
  root: "resources/i18n",
  detection: ["explicit", "path", "query", "cookie", "header"],
  queryName: "lang",
  cookieName: "warbler_locale",
  headerName: "accept-language",
  missingKey: "fallback",
} as const satisfies I18nConfigInput;

export default i18nConfig;
`;
}

function loggingConfig(): string {
  return `import { env } from "@warblerjs/config";

const isProduction = env("APP_ENV", "development") === "production";

export const loggingConfig = {
  environment: env("APP_ENV", "development") as "development" | "staging" | "production",
  requests: env.bool("LOG_REQUESTS", !isProduction),
  runtime: env.bool("LOG_RUNTIME", !isProduction),
  transports: env.bool("LOG_TRANSPORTS", !isProduction),
  websocket: env.bool("LOG_WEBSOCKET", !isProduction),
  errors: env.bool("LOG_ERRORS", true),
  fatal: env.bool("LOG_FATAL", true),
  startup: env.bool("LOG_STARTUP", !isProduction),
  debug: env.bool("LOG_DEBUG", !isProduction),
  channels: {
    console: {
      enabled: env.bool("LOG_CONSOLE", true),
    },
    file: {
      enabled: env.bool("LOG_FILE", false),
      path: env("LOG_FILE_PATH", "storage/logs"),
      rotation: "daily",
      retentionDays: env.int("LOG_RETENTION_DAYS", 14),
      cleanup: "internal",
      format: "pretty",
    },
  },
} as const;
`;
}

function mailConfig(): string {
  return `import { env } from "@warblerjs/config";
import type { EmailConfigInput } from "@warblerjs/email";

export const mailConfig = {
  default: "log",
  from: {
    address: env("MAIL_FROM_ADDRESS", "noreply@example.com"),
    name: env("MAIL_FROM_NAME", "Warbler"),
  },
  transports: {
    log: { enabled: true, logBodies: false },
    memory: { enabled: false },
  },
  limits: {},
} as const satisfies EmailConfigInput;
`;
}

function profilingConfig(): string {
  return `import { env } from "@warblerjs/config";

export const profilingConfig = {
  http: env.bool("WARBLER_HTTP_PROFILING", false),
  summaryOnStop: env.bool("WARBLER_HTTP_PROFILING_SUMMARY", true),
} as const;
`;
}

function viewConfig(): string {
  return `import type { ViewProjectConfig } from "@warblerjs/view";

export const viewConfig = {
  enabled: true,
  path: "resources/views",
  extension: ".html",
  public: "public",
  cache: false,
  hotReload: true,
  minify: false,
  assets: {
    enabled: true,
    scripts: {
      entries: {
        app: "resources/js/app.ts",
      },
    },
    styles: {
      entries: {
        app: "resources/css/app.css",
      },
      tailwind: false,
    },
    development: {
      sourceMaps: true,
    },
    production: {
      minify: true,
    },
  },
} as const satisfies ViewProjectConfig;
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
