import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as ts from "typescript";

export class StarterConfigGenerationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StarterConfigGenerationError";
  }
}

export interface GeneratedStarterConfigSource {
  readonly path: `src/config/${string}.ts`;
  readonly sourcePath: string;
  readonly content: string;
}

export interface GenerateStarterConfigsOptions {
  readonly root?: string;
  readonly check?: boolean;
}

export interface StarterConfigGenerationResult {
  readonly root: string;
  readonly generatedPath: string;
  readonly files: readonly GeneratedStarterConfigSource[];
  readonly envExample: string;
  readonly envKeys: readonly string[];
  readonly changed: boolean;
}

const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_ENV_EXAMPLE_BYTES = 128 * 1024;
const GENERATE_COMMAND = "bun run generate:cli-starter-configs";

const DIRECT_ENV_HELPERS = new Set(["env", "envString", "envNumber", "envBoolean"]);
const ENV_MEMBER_HELPERS = new Set(["optional", "bool", "int"]);

export async function generateStarterConfigs(
  options: GenerateStarterConfigsOptions = {},
): Promise<StarterConfigGenerationResult> {
  const root = await resolveMonorepoRoot(options.root);
  const configRoot = resolve(root, "playground/src/config");
  const files = await discoverStarterConfigFiles(configRoot);
  const envExample = await readStarterEnvExample(root);
  const envKeys = validateEnvExample(envExample, files);
  const generatedPath = resolveGeneratedPath(root);
  const expected = renderGeneratedFile(files, envExample);
  const current = await readOptional(generatedPath);
  if (options.check === true) {
    if (current !== expected) {
      throw new StarterConfigGenerationError(
        `Starter config snapshot is stale. Run: ${GENERATE_COMMAND}`,
      );
    }
    return Object.freeze({ root, generatedPath, files, envExample, envKeys, changed: false });
  }
  if (current === expected) return Object.freeze({ root, generatedPath, files, envExample, envKeys, changed: false });
  await atomicWrite(generatedPath, expected);
  return Object.freeze({ root, generatedPath, files, envExample, envKeys, changed: true });
}

export async function discoverStarterConfigFiles(configRoot: string): Promise<readonly GeneratedStarterConfigSource[]> {
  const rootDetails = await readPathDetails(configRoot, "config directory");
  if (rootDetails.isSymbolicLink()) throw new StarterConfigGenerationError(`Config directory is a symlink: ${configRoot}`);
  if (!rootDetails.isDirectory()) throw new StarterConfigGenerationError(`Config directory is not a directory: ${configRoot}`);

  const discovered: FileCandidate[] = [];
  await collectConfigFileCandidates(configRoot, "", discovered);
  discovered.sort((left, right) => compareString(left.relativePath, right.relativePath));
  if (discovered.length === 0) {
    throw new StarterConfigGenerationError(`Config directory contains no starter .ts files: ${configRoot}`);
  }

  let totalBytes = 0;
  const output: GeneratedStarterConfigSource[] = [];
  for (const item of discovered) {
    const bytes = await readFile(item.absolutePath);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new StarterConfigGenerationError(`Starter config file is too large: ${item.relativePath}`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new StarterConfigGenerationError(`Starter config snapshot exceeds ${MAX_TOTAL_BYTES} bytes while reading: ${item.relativePath}`);
    }
    if (bytes.includes(0)) {
      throw new StarterConfigGenerationError(`Starter config file contains a NUL byte: ${item.relativePath}`);
    }
    const decoded = decodeUtf8(bytes, item.relativePath);
    const content = normalizeSourceText(decoded);
    output.push(Object.freeze({
      path: `src/config/${item.relativePath}`,
      sourcePath: item.absolutePath,
      content,
    }));
  }
  return Object.freeze(output);
}

export async function readStarterEnvExample(root: string): Promise<string> {
  const path = resolve(root, "playground/.env.example");
  const details = await readPathDetails(path, "environment example");
  if (details.isSymbolicLink()) throw new StarterConfigGenerationError(`Environment example cannot be a symlink: playground/.env.example`);
  if (!details.isFile()) throw new StarterConfigGenerationError(`Environment example is not a regular file: playground/.env.example`);
  if (details.size > MAX_ENV_EXAMPLE_BYTES) {
    throw new StarterConfigGenerationError(`Environment example exceeds ${MAX_ENV_EXAMPLE_BYTES} bytes: playground/.env.example`);
  }
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new StarterConfigGenerationError("Environment example contains a NUL byte: playground/.env.example");
  return normalizeSourceText(decodeUtf8(bytes, "playground/.env.example"));
}

export function renderGeneratedFile(
  files: readonly GeneratedStarterConfigSource[],
  envExample: string,
): string {
  const lines = [
    "export interface GeneratedStarterConfigFile {",
    "  readonly path: `src/config/${string}.ts`;",
    "  readonly content: string;",
    "}",
    "",
    "/** Generated from playground/src/config. Do not edit manually. */",
    "export const STARTER_CONFIG_FILES: readonly GeneratedStarterConfigFile[] = Object.freeze([",
  ];
  for (const item of files) {
    lines.push(
      "  Object.freeze({",
      `    path: ${JSON.stringify(item.path)},`,
      `    content: ${JSON.stringify(item.content)},`,
      "  }),",
    );
  }
  lines.push(
    "]);",
    "",
    "/** Generated from playground/.env.example. Do not edit manually. */",
    `export const STARTER_ENV_EXAMPLE = ${JSON.stringify(envExample)} as const;`,
    "",
  );
  return lines.join("\n");
}

export function validateEnvExample(
  envExample: string,
  files: readonly GeneratedStarterConfigSource[],
): readonly string[] {
  const consumed = new Map<string, readonly EnvReference[]>();
  for (const file of files) {
    for (const reference of extractStaticEnvReferences(file)) {
      const existing = consumed.get(reference.key) ?? [];
      consumed.set(reference.key, Object.freeze([...existing, reference]));
    }
  }

  const documented = readEnvExampleKeys(envExample, "playground/.env.example");
  const missing = [...consumed.keys()].filter((key) => !documented.has(key)).sort();
  if (missing.length > 0) {
    const details = missing.map((key) => {
      const first = consumed.get(key)?.[0];
      return first === undefined ? key : `${key} (${first.path}:${first.line}:${first.column})`;
    }).join(", ");
    throw new StarterConfigGenerationError(`playground/.env.example is missing starter config environment keys: ${details}`);
  }
  return Object.freeze([...consumed.keys()].sort());
}

export function extractStaticEnvReferences(file: GeneratedStarterConfigSource): readonly EnvReference[] {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics = getParseDiagnostics(source);
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0]!;
    const position = source.getLineAndCharacterOfPosition(first.start ?? 0);
    throw new StarterConfigGenerationError(
      `Unable to parse starter config ${file.path}:${position.line + 1}:${position.character + 1}: ${ts.flattenDiagnosticMessageText(first.messageText, "\n")}`,
    );
  }
  const references: EnvReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const helper = envHelperName(node.expression);
      if (helper !== undefined) references.push(readEnvHelperReference(source, file.path, helper, node));
    } else if (ts.isPropertyAssignment(node) && propertyNameText(node.name) === "env") {
      references.push(readEnvPropertyReference(source, file.path, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.freeze(references);
}

interface FileCandidate {
  readonly absolutePath: string;
  readonly relativePath: `${string}.ts`;
}

export interface EnvReference {
  readonly key: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly form: string;
}

async function collectConfigFileCandidates(root: string, relativeDirectory: string, output: FileCandidate[]): Promise<void> {
  const entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
  entries.sort((left, right) => compareString(left.name, right.name));
  for (const entry of entries) {
    assertSafeSegment(entry.name, relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`);
    const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(root, relativePath);
    const details = await readPathDetails(absolutePath, relativePath);
    if (details.isSymbolicLink()) throw new StarterConfigGenerationError(`Starter config source cannot be a symlink: ${relativePath}`);
    if (details.isDirectory()) {
      await collectConfigFileCandidates(root, relativePath, output);
      continue;
    }
    if (!details.isFile()) throw new StarterConfigGenerationError(`Starter config source is not a regular file: ${relativePath}`);
    if (isSupportedConfigFile(relativePath)) {
      output.push(Object.freeze({ absolutePath, relativePath }));
    } else if (isTypeScriptLikeFile(relativePath)) {
      throw new StarterConfigGenerationError(`Unsupported TypeScript config file would be skipped: ${relativePath}`);
    }
  }
}

function isSupportedConfigFile(relativePath: string): relativePath is `${string}.ts` {
  if (!relativePath.endsWith(".ts") || relativePath.endsWith(".d.ts")) return false;
  const segments = relativePath.split("/");
  if (segments.some((segment) => isUnsupportedSegment(segment))) return false;
  const fileName = segments[segments.length - 1]!;
  if (fileName.includes(".generated.")) return false;
  return !/\.(?:tmp|temp|bak|backup|swp|swo)\.ts$/u.test(fileName) && !fileName.endsWith("~");
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isTypeScriptLikeFile(relativePath: string): boolean {
  return relativePath.endsWith(".ts") || relativePath.endsWith(".d.ts");
}

function isUnsupportedSegment(segment: string): boolean {
  return segment.startsWith(".") || segment === "generated" || segment === "__generated__" || segment === "tmp" || segment === "temp";
}

function assertSafeSegment(segment: string, relativePath: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\0") ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new StarterConfigGenerationError(`Starter config path contains an unsafe segment: ${relativePath}`);
  }
  if (isUnsupportedSegment(segment)) {
    throw new StarterConfigGenerationError(`Starter config path uses an unsupported segment: ${relativePath}`);
  }
}

function envHelperName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && DIRECT_ENV_HELPERS.has(expression.text)) return expression.text;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "env" &&
    ENV_MEMBER_HELPERS.has(expression.name.text)
  ) {
    return `env.${expression.name.text}`;
  }
  return undefined;
}

function readEnvHelperReference(
  source: ts.SourceFile,
  path: string,
  helper: string,
  node: ts.CallExpression,
): EnvReference {
  const keyNode = node.arguments[0];
  if (keyNode === undefined || !isStaticString(keyNode)) {
    throw new StarterConfigGenerationError(`Unsupported dynamic environment key in ${path}:${location(source, node).line}:${location(source, node).column} for ${helper}()`);
  }
  return envReference(source, path, keyNode.text, helper, keyNode);
}

function readEnvPropertyReference(
  source: ts.SourceFile,
  path: string,
  node: ts.PropertyAssignment,
): EnvReference {
  const initializer = node.initializer;
  if (!isStaticString(initializer)) {
    throw new StarterConfigGenerationError(`Unsupported dynamic environment key in ${path}:${location(source, node).line}:${location(source, node).column} for env property`);
  }
  return envReference(source, path, initializer.text, "env property", initializer);
}

function envReference(
  source: ts.SourceFile,
  path: string,
  key: string,
  form: string,
  node: ts.Node,
): EnvReference {
  if (!ENV_NAME_PATTERN.test(key)) {
    const point = location(source, node);
    throw new StarterConfigGenerationError(`Invalid environment key in ${path}:${point.line}:${point.column}: ${key}`);
  }
  const point = location(source, node);
  return Object.freeze({ key, path, line: point.line, column: point.column, form });
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function isStaticString(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function location(source: ts.SourceFile, node: ts.Node): Readonly<{ readonly line: number; readonly column: number }> {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return Object.freeze({ line: point.line + 1, column: point.character + 1 });
}

function readEnvExampleKeys(text: string, path: string): ReadonlySet<string> {
  const keys = new Set<string>();
  const lines = text.split(/\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const separator = withoutExport.indexOf("=");
    if (separator < 1) {
      throw new StarterConfigGenerationError(`Malformed environment example line in ${path}:${index + 1}`);
    }
    const key = withoutExport.slice(0, separator).trim();
    if (!ENV_NAME_PATTERN.test(key)) {
      throw new StarterConfigGenerationError(`Invalid environment example key in ${path}:${index + 1}: ${key}`);
    }
    keys.add(key);
  }
  return keys;
}

async function resolveMonorepoRoot(explicit: string | undefined): Promise<string> {
  const root = explicit === undefined
    ? resolve(import.meta.dir, "..", "..", "..")
    : resolve(explicit);
  const manifestText = await readTextFile(resolve(root, "package.json"), "monorepo package manifest");
  const manifest = parseJsonObject(manifestText, "monorepo package manifest", resolve(root, "package.json"));
  if (manifest.name !== "warbler") {
    throw new StarterConfigGenerationError(`Unable to resolve Warbler monorepo root: ${root}`);
  }
  return root;
}

function parseJsonObject(text: string, label: string, path: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) {
      throw new StarterConfigGenerationError(`${label} root is not an object: ${path}`);
    }
    return value;
  } catch (cause) {
    if (cause instanceof StarterConfigGenerationError) throw cause;
    throw new StarterConfigGenerationError(`${label} is malformed JSON: ${path}\n${errorMessage(cause)}`);
  }
}

function resolveGeneratedPath(root: string): string {
  return resolve(root, "packages/cli/src/new/starter-configs.generated.ts");
}

function normalizeSourceText(text: string): string {
  return `${text.replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`;
}

function decodeUtf8(bytes: Uint8Array, relativePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new StarterConfigGenerationError(`Starter config file is not valid UTF-8: ${relativePath}\n${errorMessage(cause)}`);
  }
}

function getParseDiagnostics(source: ts.SourceFile): readonly ts.Diagnostic[] {
  const sourceWithDiagnostics = source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] };
  return sourceWithDiagnostics.parseDiagnostics ?? [];
}

async function readTextFile(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    throw new StarterConfigGenerationError(`Unable to read ${label}: ${path}\n${errorMessage(cause)}`);
  }
}

async function readPathDetails(path: string, label: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  try {
    return await lstat(path);
  } catch (cause) {
    throw new StarterConfigGenerationError(`Unable to inspect ${label}: ${path}\n${errorMessage(cause)}`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new StarterConfigGenerationError(`Unable to write generated starter configs: ${path}\n${errorMessage(cause)}`);
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (isMissing(cause)) return undefined;
    throw new StarterConfigGenerationError(`Unable to read generated starter configs: ${path}\n${errorMessage(cause)}`);
  }
}

function parseArgs(argv: readonly string[]): GenerateStarterConfigsOptions {
  let check = false;
  let root: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--check") {
      check = true;
    } else if (arg === "--root") {
      const value = argv[index + 1];
      if (value === undefined) throw new StarterConfigGenerationError("--root requires a path");
      root = value;
      index++;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
      if (root.length === 0) throw new StarterConfigGenerationError("--root requires a path");
    } else {
      throw new StarterConfigGenerationError(`Unknown argument: ${arg}`);
    }
  }
  return Object.freeze({
    ...(root === undefined ? {} : { root }),
    ...(check ? { check } : {}),
  });
}

function isMissing(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

if (import.meta.main) {
  try {
    const result = await generateStarterConfigs(parseArgs(Bun.argv.slice(2)));
    const action = result.changed ? "Generated" : "Starter configs already current";
    console.log(`${action}: ${result.generatedPath}`);
  } catch (cause) {
    console.error(errorMessage(cause));
    process.exit(1);
  }
}
