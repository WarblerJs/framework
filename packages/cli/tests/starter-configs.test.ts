import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverStarterConfigFiles,
  generateStarterConfigs,
  readStarterEnvExample,
  StarterConfigGenerationError,
} from "../scripts/generate-starter-configs";
import { STARTER_CONFIG_FILES, STARTER_ENV_EXAMPLE } from "../src/new/starter-configs.generated";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const task of cleanup.splice(0)) await task(); });

describe("starter config snapshot", () => {
  test("generated config files match the reviewed playground config tree", async () => {
    const root = repoRoot();
    const discovered = await discoverStarterConfigFiles(join(root, "playground/src/config"));
    expect(STARTER_CONFIG_FILES.map((item) => item.path)).toEqual(discovered.map((item) => item.path));
    expect(STARTER_CONFIG_FILES.map((item) => item.path)).toEqual([...STARTER_CONFIG_FILES.map((item) => item.path)].sort());
    for (const item of STARTER_CONFIG_FILES) {
      const source = discovered.find((candidate) => candidate.path === item.path);
      expect(source).toBeDefined();
      expect(item.content).toBe(source!.content);
      expect(Object.isFrozen(item)).toBe(true);
    }
    expect(Object.isFrozen(STARTER_CONFIG_FILES)).toBe(true);
  });

  test("generated environment example matches the reviewed playground source", async () => {
    expect(STARTER_ENV_EXAMPLE as string).toBe(await readStarterEnvExample(repoRoot()));
    expect(STARTER_ENV_EXAMPLE).toContain("APP_CRYPTO_KEY=\n");
    expect(STARTER_ENV_EXAMPLE).toContain("APP_HMAC_KEY=\n");
    expect(STARTER_ENV_EXAMPLE).toContain("APP_HTTP_PORT=3000");
    expect(STARTER_ENV_EXAMPLE).toContain("APP_HTTTP_PORT=3000");
    expect(STARTER_ENV_EXAMPLE).toContain("WS_ALLOWED_ORIGINS=");
    expect(STARTER_ENV_EXAMPLE).not.toContain("AAAAAAAAAAAAAAAA");
  });

  test("includes every current transporter config regression file", () => {
    const paths = STARTER_CONFIG_FILES.map((item) => item.path);
    expect(paths).toContain("src/config/transports/http.config.ts");
    expect(paths).toContain("src/config/transports/mcp.config.ts");
    expect(paths).toContain("src/config/transports/tcp.config.ts");
    expect(paths).toContain("src/config/transports/udp.config.ts");
    expect(paths).toContain("src/config/transports/webrtc.config.ts");
    expect(paths).toContain("src/config/transports/ws.config.ts");
    expect(paths).toContain("src/config/view.ts");
    expect(paths).not.toContain("src/config/view.config.ts");
  });

  test("check mode succeeds when current", async () => {
    const result = await generateStarterConfigs({ root: repoRoot(), check: true });
    expect(result.changed).toBe(false);
    expect(result.files.map((item) => item.path)).toEqual(STARTER_CONFIG_FILES.map((item) => item.path));
    expect(result.envExample).toBe(STARTER_ENV_EXAMPLE);
    expect((await runGenerator(repoRoot(), "--check")).exitCode).toBe(0);
  });

  test("check mode fails without writing when stale", async () => {
    const root = await fixtureRoot(); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await generateStarterConfigs({ root });
    const generated = generatedPath(root);
    const stale = "/** stale config snapshot */\n";
    await writeFile(generated, stale, "utf8");
    const script = await runGenerator(root, "--check");
    expect(script.exitCode).toBe(1);
    expect(script.stderr).toContain("Starter config snapshot is stale");
    expect(script.stderr).toContain("bun run generate:cli-starter-configs");
    await expect(generateStarterConfigs({ root, check: true })).rejects.toThrow(StarterConfigGenerationError);
    expect(await readFile(generated, "utf8")).toBe(stale);
  });

  test("environment helper keys must be documented in playground .env.example", async () => {
    const root = await fixtureRoot({ envExample: "APP_ENV=development\n" });
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await expect(generateStarterConfigs({ root })).rejects.toThrow("APP_HOST");
  });

  test("dynamic environment helper keys fail clearly", async () => {
    const root = await fixtureRoot({
      config: "import { envString } from \"@warblerjs/config\";\nconst key = \"APP_HOST\";\nexport const runtimeConfig = { host: envString(key, \"127.0.0.1\") };\n",
    });
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await expect(generateStarterConfigs({ root })).rejects.toThrow("Unsupported dynamic environment key");
  });

  test("real playground .env is never read", async () => {
    const root = await fixtureRoot();
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "playground/.env"));
    await expect(generateStarterConfigs({ root })).resolves.toMatchObject({ changed: true });
  });
});

function repoRoot(): string {
  return resolve(import.meta.dir, "..", "..", "..");
}

async function runGenerator(root: string, ...args: readonly string[]): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const child = Bun.spawn([
    "bun",
    "run",
    resolve(import.meta.dir, "../scripts/generate-starter-configs.ts"),
    "--root",
    root,
    ...args,
  ], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

function generatedPath(root: string): string {
  return join(root, "packages/cli/src/new/starter-configs.generated.ts");
}

async function fixtureRoot(options: Readonly<{
  readonly config?: string;
  readonly envExample?: string;
}> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "warbler-starter-configs-"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "warbler", private: true }, null, 2)}\n`, "utf8");
  await mkdir(join(root, "packages/cli/src/new"), { recursive: true });
  await mkdir(join(root, "playground/src/config/transports"), { recursive: true });
  await writeFile(
    join(root, "playground/src/config/runtime.config.ts"),
    options.config ?? "import { envString } from \"@warblerjs/config\";\nexport const runtimeConfig = { host: envString(\"APP_HOST\", \"127.0.0.1\") };\n",
    "utf8",
  );
  await writeFile(
    join(root, "playground/src/config/transports/http.config.ts"),
    "export const httpConfig = { port: 3000 } as const;\n",
    "utf8",
  );
  await writeFile(
    join(root, "playground/.env.example"),
    options.envExample ?? "APP_HOST=127.0.0.1\n",
    "utf8",
  );
  return root;
}
