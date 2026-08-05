import type { AstNode, TemplateAst } from "./ast";
import { createCompiledViewArtifact } from "./artifact";
import { TemplateCompilationError, ViewError, ViewNotFoundException } from "./errors";
import { parseTemplate } from "./parser";
import type {
  CompiledAstMap,
  CompiledTemplateMap,
  CompiledViewArtifact,
  ViewCompilationResult,
  ViewDependencyMap,
  ViewProjectConfig,
} from "./types";

export interface CompileViewProjectOptions {
  readonly projectRoot: string;
  readonly config?: ViewProjectConfig;
  readonly mode?: "development" | "production";
  readonly previous?: CompiledViewArtifact;
  readonly changedTemplates?: readonly string[];
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Compiles templates and frontend assets before Runtime starts. */
export async function compileViewProject(
  options: CompileViewProjectOptions,
): Promise<ViewCompilationResult> {
  const config: ViewProjectConfig = options.config ?? Object.freeze({});
  const root = cleanRoot(options.projectRoot);
  const viewDirectory = safeRelative(config.path ?? "resources/views", "View directory");
  const extension = validExtension(config.extension ?? ".html");
  const glob = new Bun.Glob(`**/*${extension}`);
  const names: string[] = [];
  for await (const path of glob.scan({ cwd: `${root}/${viewDirectory}`, onlyFiles: true })) {
    names.push(path);
  }
  names.sort(compareText);

  const sources: Record<string, string> = Object.create(null);
  const ast: Record<string, TemplateAst> = Object.create(null);
  for (const path of names) {
    const name = logicalName(path, extension);
    const source = await Bun.file(`${root}/${viewDirectory}/${path}`).text();
    sources[name] = source;
    try {
      ast[name] = parseTemplate(source);
    } catch (cause) {
      if (cause instanceof ViewError) throw cause;
      throw new TemplateCompilationError(name, safeMessage(cause), cause);
    }
  }

  const dependencies = buildDependencies(ast);
  validateReferences(ast, dependencies);
  const dependents = reverseDependencies(dependencies);
  rejectCycles(dependencies);
  const compiled = affectedTemplates(
    Object.keys(sources),
    options.changedTemplates,
    dependents,
    options.previous,
    sources,
    viewDirectory,
  );
  const production = options.mode === "production";
  const artifact = createCompiledViewArtifact({
    ...(config.defaultLayout === undefined ? {} : { defaultLayout: config.defaultLayout }),
    hotReload: !production && config.hotReload === true,
    cache: config.cache !== false,
    minify: production ? config.assets?.production?.minify === true : config.minify === true,
    templates: Object.freeze(sources),
    ast: Object.freeze(ast),
    dependencies,
    dependents,
  });

  if (config.assets?.enabled === true) {
    await buildFrontendAssets(root, config, production);
  }

  return Object.freeze({
    artifact,
    compiled,
    fingerprint: Bun.hash(JSON.stringify({
      config,
      templates: sources,
      dependencies,
    })).toString(16),
  });
}

function buildDependencies(ast: Readonly<Record<string, TemplateAst>>): ViewDependencyMap {
  const output: Record<string, readonly string[]> = Object.create(null);
  for (const name of Object.keys(ast).sort(compareText)) {
    const found = new Set<string>();
    const template = ast[name];
    if (template?.extendsName !== undefined) found.add(template.extendsName);
    collectNodeDependencies(template?.body ?? [], found);
    for (const section of Object.values(template?.sections ?? {})) collectNodeDependencies(section, found);
    output[name] = Object.freeze([...found].sort(compareText));
  }
  return Object.freeze(output);
}

function collectNodeDependencies(nodes: readonly AstNode[], output: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "import") output.add(node.name);
    else if (node.kind === "if") for (const branch of node.branches) collectNodeDependencies(branch.body, output);
    else if (node.kind === "for") collectNodeDependencies(node.body, output);
    else if (node.kind === "switch") for (const item of node.cases) collectNodeDependencies(item.body, output);
  }
}

function reverseDependencies(input: ViewDependencyMap): ViewDependencyMap {
  const mutable: Record<string, string[]> = Object.create(null);
  for (const name of Object.keys(input)) mutable[name] = [];
  for (const [name, values] of Object.entries(input)) {
    for (const dependency of values) (mutable[dependency] ??= []).push(name);
  }
  const output: Record<string, readonly string[]> = Object.create(null);
  for (const name of Object.keys(mutable).sort(compareText)) {
    output[name] = Object.freeze((mutable[name] ?? []).sort(compareText));
  }
  return Object.freeze(output);
}

function validateReferences(ast: CompiledAstMap, dependencies: ViewDependencyMap): void {
  for (const [name, values] of Object.entries(dependencies)) {
    for (const dependency of values) {
      if (ast[dependency] === undefined) {
        throw new ViewNotFoundException(dependency, Object.freeze(Object.keys(ast).sort(compareText)));
      }
    }
    if (name.includes("..")) throw new TemplateCompilationError(name, "Unsafe template name.");
  }
}

function rejectCycles(graph: ViewDependencyMap): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string, path: readonly string[]): void => {
    if (visiting.has(name)) {
      throw new TemplateCompilationError(name, `Circular view dependency: ${[...path, name].join(" -> ")}`);
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of graph[name] ?? []) visit(dependency, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of Object.keys(graph).sort(compareText)) visit(name, []);
}

function affectedTemplates(
  all: readonly string[],
  changed: readonly string[] | undefined,
  dependents: ViewDependencyMap,
  previous: CompiledViewArtifact | undefined,
  sources: CompiledTemplateMap,
  viewDirectory: string,
): readonly string[] {
  if (previous === undefined || changed === undefined) return Object.freeze([...all]);
  const prefix = `${viewDirectory}/`;
  const queue = changed.map((path) => {
    const normalized = path.replaceAll("\\", "/");
    const relative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    return logicalName(relative, /\.[^.]+$/u.exec(relative)?.[0] ?? "");
  });
  const output = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || output.has(name)) continue;
    output.add(name);
    queue.push(...(dependents[name] ?? previous.dependents[name] ?? []));
  }
  for (const name of all) {
    if (previous.templates[name] !== sources[name] && output.size === 0) output.add(name);
  }
  return Object.freeze([...output].filter((name) => sources[name] !== undefined).sort(compareText));
}

async function buildFrontendAssets(root: string, config: ViewProjectConfig, production: boolean): Promise<void> {
  const publicDirectory = safeRelative(config.public ?? "public", "Public directory");
  const sourceMap = !production && config.assets?.development?.sourceMaps === true ? "external" : "none";
  const minify = production && config.assets?.production?.minify === true;
  await buildAssetGroup(root, publicDirectory, "app.js", config.assets?.scripts?.entries, "js", sourceMap, minify);
  await buildAssetGroup(root, publicDirectory, "app.css", config.assets?.styles?.entries, "css", sourceMap, minify);
}

async function buildAssetGroup(
  root: string,
  publicDirectory: string,
  output: string,
  entries: Readonly<Record<string, string>> | undefined,
  kind: "js" | "css",
  sourcemap: "external" | "none",
  minify: boolean,
): Promise<void> {
  const paths = Object.values(entries ?? {}).sort(compareText).map((path) => safeRelative(path, `${kind} entry`));
  if (paths.length === 0) return;
  const virtualDirectory = `${root}/.warbler/view`;
  const entry = `${virtualDirectory}/${kind}.entry.${kind === "js" ? "ts" : "css"}`;
  const imports = paths.map((path) => kind === "css"
    ? `@import ${JSON.stringify(`../../${path}`)};`
    : `import ${JSON.stringify(`../../${path}`)};`
  ).join("\n");
  await Bun.write(entry, `${imports}\n`);
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify,
    sourcemap,
    naming: output,
    outdir: `${root}/${publicDirectory}`,
  });
  if (!result.success) {
    throw new TemplateCompilationError(output, result.logs.map((log) => log.message).join("\n"));
  }
}

function safeRelative(value: string, label: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/u, "").replace(/\/+/gu, "/");
  if (normalized.length === 0 || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new TemplateCompilationError(label, `${label} must remain inside the project.`);
  }
  return normalized.replace(/\/$/u, "");
}
function cleanRoot(value: string): string { return value.replaceAll("\\", "/").replace(/\/+$/u, ""); }
function validExtension(value: string): string {
  if (!/^\.[A-Za-z0-9]+$/u.test(value)) throw new TemplateCompilationError("configuration", "Invalid View extension.");
  return value;
}
function logicalName(path: string, extension: string): string {
  const clean = path.replaceAll("\\", "/");
  const withoutExtension = extension.length > 0 && clean.endsWith(extension) ? clean.slice(0, -extension.length) : clean;
  if (withoutExtension.split("/").includes("..")) throw new TemplateCompilationError(path, "Unsafe template path.");
  return withoutExtension.replaceAll("/", ".");
}
function safeMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
