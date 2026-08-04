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
    symlink(join(packagesRoot, "http"), join(scope, "http")),
    symlink(join(packagesRoot, "runtime"), join(scope, "runtime")),
    symlink(join(packagesRoot, "transport"), join(scope, "transport")),
  ]);
  return Object.freeze({ root, cleanup: () => rm(parent, { recursive: true, force: true }) });
}
/** Captures CLI output. */
export function captureOutput(): { readonly lines: string[]; readonly errors: string[]; readonly output: { write(message: string): void; error(message: string): void } } {
  const lines: string[] = []; const errors: string[] = [];
  return { lines, errors, output: { write(message) { lines.push(message); }, error(message) { errors.push(message); } } };
}
