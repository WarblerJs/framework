import { TemplateCompilationError } from "./errors";

export interface TailwindBuildOptions {
  readonly projectRoot: string;
  readonly publicDirectory: string;
  readonly entries: readonly string[];
  readonly minify: boolean;
}

/** Runs one official Tailwind CSS v4 CLI compilation and atomically publishes app.css. */
export async function buildTailwindCss(options: TailwindBuildOptions): Promise<void> {
  if (options.entries.length === 0) {
    throw new TemplateCompilationError("Tailwind configuration", "Tailwind requires at least one CSS entry.");
  }
  const official = await resolveOfficialTailwindCli();
  const buildDirectory = `${options.projectRoot}/.warbler/view`;
  const input = options.entries.length === 1
    ? `${options.projectRoot}/${options.entries[0]}`
    : await writeCombinedEntry(buildDirectory, options.entries);
  if (!await Bun.file(input).exists()) {
    throw new TemplateCompilationError(input, "Configured Tailwind CSS entry does not exist.");
  }
  const temporary = `${buildDirectory}/app.${Bun.hash(input).toString(16)}.css.tmp`;
  const output = `${options.projectRoot}/${options.publicDirectory}/app.css`;
  await Bun.write(temporary, "");
  const command = [
    process.execPath,
    official.cli,
    "--input",
    input,
    "--output",
    temporary,
    ...(options.minify ? ["--minify"] : []),
  ];
  const child = Bun.spawn(command, {
    cwd: options.projectRoot,
    env: {
      ...process.env,
      NODE_PATH: [process.env.NODE_PATH, official.moduleRoot].filter(
        (value): value is string => value !== undefined && value.length > 0,
      ).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const detail = stripAnsi([stderr.trim(), stdout.trim()].filter(Boolean).join("\n"));
    throw new TemplateCompilationError(
      "Tailwind CSS",
      detail.length === 0 ? `Official Tailwind CLI exited with code ${exitCode}.` : detail,
    );
  }
  const candidate = Bun.file(temporary);
  if (!await candidate.exists() || candidate.size === 0) {
    throw new TemplateCompilationError("Tailwind CSS", "Tailwind produced an empty CSS artifact.");
  }
  const replacement = Bun.spawn(["mv", "-f", temporary, output], {
    cwd: options.projectRoot,
    stdout: "ignore",
    stderr: "pipe",
  });
  const replacementError = new Response(replacement.stderr).text();
  const replacementExit = await replacement.exited;
  if (replacementExit !== 0) {
    throw new TemplateCompilationError(
      "Tailwind CSS",
      `Atomic app.css replacement failed: ${(await replacementError).trim()}`,
    );
  }
}

async function resolveOfficialTailwindCli(): Promise<Readonly<{ cli: string; moduleRoot: string }>> {
  try {
    const manifestPath = Bun.resolveSync("@tailwindcss/cli/package.json", import.meta.dir);
    const manifest: unknown = await Bun.file(manifestPath).json();
    if (typeof manifest !== "object" || manifest === null || !("bin" in manifest)) throw new Error("CLI manifest has no bin field.");
    const bin = (manifest as Readonly<{ bin?: unknown }>).bin;
    const relative = typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null && "tailwindcss" in bin
        ? (bin as Readonly<{ tailwindcss?: unknown }>).tailwindcss
        : undefined;
    if (typeof relative !== "string" || relative.includes("..") || relative.startsWith("/")) {
      throw new Error("CLI manifest has an invalid bin field.");
    }
    return Object.freeze({
      cli: `${manifestPath.slice(0, -"package.json".length)}${relative.replace(/^\.\//u, "")}`,
      moduleRoot: `${import.meta.dir.replace(/\/src$/u, "")}/node_modules`,
    });
  } catch (cause) {
    throw new TemplateCompilationError(
      "Tailwind CSS",
      'Official Tailwind v4 packages are missing. Install "tailwindcss" and "@tailwindcss/cli".',
      cause,
    );
  }
}
function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
}

async function writeCombinedEntry(directory: string, entries: readonly string[]): Promise<string> {
  const path = `${directory}/tailwind.entry.css`;
  const source = entries
    .map((entry) => `@import ${JSON.stringify(`../../${entry}`)};`)
    .join("\n");
  await Bun.write(path, `${source}\n`);
  return path;
}
