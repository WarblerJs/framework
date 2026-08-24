import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createStarterProject } from "../src";

/** Creates a valid disposable project beneath the workspace for module resolution. */
export async function createTestProject(): Promise<{ readonly root: string; cleanup(): Promise<void> }> {
  const cliRoot = resolve(import.meta.dir, "..");
  const packagesRoot = resolve(cliRoot, "..");
  const parent = await mkdtemp(join(cliRoot, ".cli-test-"));
  const root = await createStarterProject(parent, "test-app");
  const scope = join(root, "node_modules", "@warbler");
  await mkdir(scope, { recursive: true });
  await Promise.all([
    symlink(join(packagesRoot, "config"), join(scope, "config")),
    symlink(join(packagesRoot, "core"), join(scope, "core")),
    symlink(join(packagesRoot, "database"), join(scope, "database")),
    symlink(join(packagesRoot, "framework"), join(scope, "framework")),
    symlink(join(packagesRoot, "http"), join(scope, "http")),
    symlink(join(packagesRoot, "runtime"), join(scope, "runtime")),
	    symlink(join(packagesRoot, "transport"), join(scope, "transport")),
	    symlink(join(packagesRoot, "validators"), join(scope, "validators")),
	    symlink(join(packagesRoot, "websocket"), join(scope, "websocket")),
	  ]);
  const tsconfig = await Bun.file(join(root, "tsconfig.json")).json() as {
    readonly compilerOptions?: Readonly<Record<string, unknown>>;
    readonly include?: readonly string[];
  };
  await Bun.write(join(root, "tsconfig.json"), `${JSON.stringify({
    ...tsconfig,
    compilerOptions: {
      ...tsconfig.compilerOptions,
      baseUrl: ".",
      paths: {
        "@warbler/config": ["node_modules/@warbler/config/src/index.ts"],
        "@warbler/core": ["node_modules/@warbler/core/src/index.ts"],
        "@warbler/database": ["node_modules/@warbler/database/src/index.ts"],
        "@warbler/framework": ["node_modules/@warbler/framework/src/index.ts"],
        "@warbler/http": ["node_modules/@warbler/http/src/index.ts"],
        "@warbler/runtime": ["node_modules/@warbler/runtime/src/index.ts"],
        "@warbler/transport": ["node_modules/@warbler/transport/src/index.ts"],
        "@warbler/validators": ["node_modules/@warbler/validators/src/index.ts"],
        "@warbler/websocket": ["node_modules/@warbler/websocket/src/index.ts"],
      },
    },
  }, null, 2)}\n`);
  return Object.freeze({ root, cleanup: () => rm(parent, { recursive: true, force: true }) });
}
/** Captures CLI output. */
export function captureOutput(): { readonly lines: string[]; readonly errors: string[]; readonly output: { write(message: string): void; error(message: string): void } } {
  const lines: string[] = []; const errors: string[] = [];
  return { lines, errors, output: { write(message) { lines.push(message); }, error(message) { errors.push(message); } } };
}
