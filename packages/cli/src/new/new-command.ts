import { mkdir } from "node:fs/promises";
import { resolveInside, atomicWrite, pathExists } from "../filesystem";
import { CLIError } from "../errors";
import { ExitCode } from "../types";

/** Creates a secure current Warbler starter application. */
export async function createStarterProject(cwd: string, name: string | undefined, dryRun = false): Promise<string> {
  if (name === undefined || !/^[a-z][a-z0-9-]*$/u.test(name)) throw new CLIError("CLI5101", "Project name must be lowercase kebab-case.", ExitCode.INVALID_ARGUMENTS);
  const root = resolveInside(cwd, name);
  if (await pathExists(root)) throw new CLIError("CLI5102", `Project already exists: ${name}`, ExitCode.FILESYSTEM_FAILURE);
  if (dryRun) return root;
  await mkdir(root);
  const files: Readonly<Record<string, string>> = Object.freeze({
    "package.json": JSON.stringify({
      name, version: "0.1.0", private: true, type: "module",
      scripts: { dev: "warbler dev", build: "warbler build", start: "warbler start", doctor: "warbler doctor", inspect: "warbler inspect", test: "bun test", typecheck: "tsc --noEmit" },
      dependencies: { "@warblerjs/framework": "^0.1.0", "@warblerjs/runtime": "^0.1.0", "@warblerjs/http": "^0.1.0" },
      devDependencies: { "@warblerjs/cli": "^0.1.0", "@types/bun": "latest", typescript: "^5.9.2" },
    }, null, 2) + "\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true, types: ["bun"] }, include: ["src", ".warbler/generated/context.generated.d.ts"] }, null, 2) + "\n",
    ".gitignore": "node_modules/\ndist/\n.warbler/\n",
    "src/main.ts": `import { createApp, Transport } from "@warblerjs/framework";\n\nexport default createApp({\n  transports: [Transport.HTTP],\n  graphs: "src/graphs/**/*.graph.ts",\n});\n`,
    "src/config/runtime.config.ts": `export default {\n  network: { host: "127.0.0.1" },\n  transports: {\n    http: { enabled: true, port: 3000 },\n    websocket: { enabled: false }, tcp: { enabled: false }, udp: { enabled: false },\n    mcp: { enabled: false }, webrtc: { enabled: false },\n  },\n  telemetry: {\n    metrics: { enabled: false, host: "127.0.0.1", port: 9090, path: "/metrics" },\n    healthCheck: { enabled: false, host: "127.0.0.1", port: 9091, path: "/health" },\n  },\n} as const;\n`,
    "src/config/transports/http.config.ts": `export const httpConfig = {
  request: {
    body: { unknownContentType: "reject" },
    headers: {}, query: {}, cookies: {}, path: {},
    timeouts: { idle: 10_000 },
  },
  rateLimit: { onExceeded: "reject", statusCode: 429 },
} as const;
`,
    "src/graphs/home/home.graph.ts": `import { defineHttpGraph } from "@warblerjs/framework";\n\nimport * as handlers from "./presentation/http/handlers/home.handlers";\n\nexport default defineHttpGraph({\n  prefix: "/",\n\n  middlewares: [],\n\n  providers: [],\n\n  routes: {\n    "GET /": {\n      name: "home.index",\n      handler: handlers.index,\n    },\n  },\n});\n`,
    "src/graphs/home/presentation/http/handlers/home.handlers.ts": `import { defineHandler, JsonRes } from "@warblerjs/framework";\n\nconst message = "Warbler";\n\nexport const index = defineHandler({\n  run: () => JsonRes({ message }),\n});\n`,
  });
  for (const [path, content] of Object.entries(files)) await atomicWrite(root, path, content);
  await Promise.all([mkdir(resolveInside(root, "public"), { recursive: true }), mkdir(resolveInside(root, "resources/views"), { recursive: true })]);
  return root;
}
