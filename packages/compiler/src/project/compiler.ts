import ts from "typescript";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Console, createCorrelationId } from "@warblerjs/console";
import { analyzeProgram } from "../analyzer/analyze-program";
import { discoverProject, loadProjectConfig } from "../filesystem/discover-project";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostic";
import { validateApplication } from "../validation/validate-application";
import type { ApplicationWIR } from "../wir/wir";
import { CompilerContext } from "./compiler-context";
import { optimizeWIR } from "../optimizer/optimize-wir";
import { generateArtifacts, writeArtifacts, writeRuntimeSnapshot } from "../generator/generate-artifacts";
import { analyzeContextBindings, analyzeExecutableBindings } from "../bindings";
import type { GeneratedApplication } from "../output/artifact-types";
import { sourceMetadataSignature, type SourceChangeKind } from "./source-metadata-signature";

export interface CompileOptions {
  /**
   * Runs TypeScript semantic diagnostics for the entire program.
   *
   * Keep enabled for production builds, CI, and explicit type-check commands.
   * Disable on the development hot path because full semantic diagnostics can
   * dominate save/recompile latency.
   *
   * @default true
   */
  readonly semanticDiagnostics?: boolean;
}

/**
 * Warbler compiler facade.
 *
 * A Compiler instance retains the previous TypeScript Program so repeated
 * development compilations can reuse TypeScript's internal source/program
 * structures instead of rebuilding from a completely cold program each time.
 */
export class Compiler {
  readonly #projectRoot: string;
  #program: ts.Program | undefined;
  #host: ts.CompilerHost | undefined;
  #hostOptionsKey: string | undefined;
  readonly #sourceFileCache = new Map<string, CachedSourceFile>();
  readonly #changedSourceFiles = new Set<string>();
  readonly #invalidatedCompilerFiles = new Set<string>();
  #warblerState: WarblerPipelineState | undefined;

  /** Creates a compiler rooted at the supplied application directory. */
  public constructor(projectRoot: string = process.cwd()) {
    this.#projectRoot = ts.sys.resolvePath(projectRoot);
  }

  /** Evicts source files whose on-disk contents changed before the next compile. */
  public markChanged(fileName: string): void {
    if (isCompilerConfigurationPath(fileName)) {
      this.reset();
      return;
    }

    const canonical = this.#canonicalPath(fileName);
    this.#changedSourceFiles.add(canonical);
    this.#invalidatedCompilerFiles.add(canonical);
  }

  /** Evicts a coalesced watcher batch before the next compile. */
  public markChangedFiles(fileNames: readonly string[]): void {
    if (fileNames.some(isCompilerConfigurationPath)) {
      this.reset();
      return;
    }

    for (const fileName of fileNames) this.markChanged(fileName);
  }

  /** Drops retained TypeScript state when project shape or compiler options may have changed. */
  public reset(): void {
    this.#program = undefined;
    this.#host = undefined;
    this.#hostOptionsKey = undefined;
    this.#sourceFileCache.clear();
    this.#changedSourceFiles.clear();
    this.#invalidatedCompilerFiles.clear();
    this.#warblerState = undefined;
  }

  /**
   * Discovers, loads, analyzes, validates, and emits the Warbler application.
   *
   * Reuse the same Compiler instance in `warbler dev` so `oldProgram` remains
   * available across file saves.
   */
  public async compile(options: Readonly<CompileOptions> = {}): Promise<CompilerContext> {
    await Promise.resolve();

    const semanticDiagnostics = options.semanticDiagnostics ?? true;
    const compileId = createCorrelationId("compile");
    const timer = Console.timer("Compiler", {
      compileId,
      projectRoot: this.#projectRoot,
    });

    Console.compiler("Discovering project and Graphs", "started", { compileId });

    try {
      const config = discoverProject(this.#projectRoot);
      const parsed = loadProjectConfig(config);

      Console.compiler("Discovering project and Graphs", "success", { compileId });
      Console.compiler("Building dependency graph", "started", { compileId });

      this.#resetIfCompilerOptionsChanged(parsed.options);
      const changedSourceFiles = this.#evictInvalidatedCompilerFiles();
      const host = this.#compilerHost(parsed.options);
      const program = ts.createProgram({
        rootNames: applicationRootNames(parsed.fileNames, config.projectRoot),
        options: parsed.options,
        host,

        ...(this.#program === undefined
          ? {}
          : { oldProgram: this.#program }),

        ...(parsed.projectReferences === undefined
          ? {}
          : { projectReferences: parsed.projectReferences }),
      });

      this.#program = program;

      const sourceFiles = program
        .getSourceFiles()
        .filter((source) => isApplicationSource(source.fileName, config.projectRoot));

      const typeScriptDiagnostics: ts.Diagnostic[] = [
        ...parsed.errors,
        ...program.getSyntacticDiagnostics(),
      ];

      if (semanticDiagnostics) {
        typeScriptDiagnostics.push(...program.getSemanticDiagnostics());
      }

      const diagnostics = typeScriptDiagnostics.map(normalizeTypeScriptDiagnostic);
      const context = new CompilerContext(program, sourceFiles, config, diagnostics);
      const sourceFilesByPath = this.#sourceFilesByPath(sourceFiles);
      const sourceSignatures = this.#sourceSignatures(sourceFilesByPath, changedSourceFiles);
      const changeKind = this.#classifySourceChange(changedSourceFiles, sourceSignatures);

      if (changeKind === "code" && this.#warblerState !== undefined && !hasTypeScriptErrors(context.diagnostics)) {
        context.diagnostics.push(...this.#warblerState.diagnostics);
        context.applicationWIR = this.#warblerState.applicationWIR;
        const sourceHashes = this.#sourceHashes(sourceFilesByPath, changedSourceFiles);
        if (this.#warblerState.generatedApplication !== undefined) {
          context.generatedApplication = this.#warblerState.generatedApplication;
          await this.#writeGeneratedApplication(context, sourceFiles, sourceHashes, true);
        }
        this.#warblerState = Object.freeze({
          applicationWIR: context.applicationWIR,
          diagnostics: this.#warblerState.diagnostics,
          sourceSignatures,
          sourceHashes,
          ...(context.generatedApplication === undefined ? {} : { generatedApplication: context.generatedApplication }),
        });

        const elapsed = timer.end({ diagnostics: context.diagnostics.length });
        Console.compiler("Building dependency graph", "success", { compileId });
        Console.success("Compiler completed.", {
          compileId,
          duration: elapsed,
        });

        return context;
      }
      const diagnosticOffset = context.diagnostics.length;

      context.applicationWIR = validateApplication(
        config.projectRoot,
        analyzeProgram(context),
        context.diagnostics,
      );

      for (const diagnostic of context.diagnostics) {
        Console.diagnostic({
          source: "compiler",
          code: diagnostic.code,
          severity: diagnostic.category,
          message: diagnostic.message,
          ...(diagnostic.sourceFile.length === 0
            ? {}
            : {
                file: diagnostic.sourceFile,
                line: diagnostic.line,
                column: diagnostic.column,
              }),
        });
      }

      Console.compiler("Building dependency graph", "success", { compileId });
      Console.compiler("Optimizing lookup tables", "started", { compileId });

      const optimized = optimizeWIR(context.applicationWIR);

      Console.compiler("Optimizing lookup tables", "success", { compileId });
      Console.compiler("Generating executable bindings", "started", { compileId });

      const bindings = analyzeExecutableBindings(
        context,
        context.applicationWIR,
        optimized,
      );
      let sourceHashes: ReadonlyMap<string, SourceHash> | undefined;

      if (bindings !== undefined) {
        const contextEntries = analyzeContextBindings(context, optimized);

        context.generatedApplication = generateArtifacts(
          optimized,
          bindings,
          contextEntries,
        );

        sourceHashes = this.#sourceHashes(sourceFilesByPath, changedSourceFiles);
        await this.#writeGeneratedApplication(context, sourceFiles, sourceHashes, false);
      }

      this.#warblerState = Object.freeze({
        applicationWIR: context.applicationWIR,
        diagnostics: Object.freeze(context.diagnostics.slice(diagnosticOffset)),
        sourceSignatures,
        sourceHashes: sourceHashes ?? this.#sourceHashes(sourceFilesByPath, changedSourceFiles),
        ...(context.generatedApplication === undefined ? {} : { generatedApplication: context.generatedApplication }),
      });

      const elapsed = timer.end({ diagnostics: context.diagnostics.length });

      Console.compiler(
        "Generating executable bindings",
        bindings === undefined ? "failure" : "success",
        { compileId },
      );

      Console.success("Compiler completed.", {
        compileId,
        duration: elapsed,
      });

      return context;
    } catch (cause) {
      const elapsed = timer.end();

      Console.compiler("Compiler", "failure", {
        compileId,
        duration: elapsed,
      });

      const root = ts.sys.resolvePath(this.#projectRoot);
      const config = Object.freeze({
        projectRoot: root,
        tsconfigPath: `${root}/tsconfig.json`,
      });

      const program = ts.createProgram({
        rootNames: [],
        options: {
          strict: true,
          noEmit: true,
        },
      });

      const context = new CompilerContext(
        program,
        [],
        config,
        [projectDiagnostic(cause)],
      );

      context.applicationWIR = Object.freeze({
        version: 1,
        projectRoot: config.projectRoot,
        transports: Object.freeze([]),
        middleware: Object.freeze([]),
        graphs: Object.freeze([]),
        rootProviders: Object.freeze([]),
        events: Object.freeze([]),
        eventListeners: Object.freeze([]),
        eventInterceptors: Object.freeze([]),
      });

      return context;
    }
  }

  #compilerHost(options: ts.CompilerOptions): ts.CompilerHost {
    if (this.#host !== undefined) return this.#host;

    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);

    host.getSourceFile = (
      fileName: string,
      languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean,
    ): ts.SourceFile | undefined => this.#sourceFile(
      fileName,
      () => getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile),
      shouldCreateNewSourceFile === true,
    );

    const getSourceFileByPath = host.getSourceFileByPath?.bind(host);
    if (getSourceFileByPath !== undefined) {
      host.getSourceFileByPath = (
        fileName: string,
        path: ts.Path,
        languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
        onError?: (message: string) => void,
        shouldCreateNewSourceFile?: boolean,
      ): ts.SourceFile | undefined => this.#sourceFile(
        fileName,
        () => getSourceFileByPath(fileName, path, languageVersionOrOptions, onError, shouldCreateNewSourceFile),
        shouldCreateNewSourceFile === true,
      );
    }

    this.#host = host;
    return host;
  }

  #resetIfCompilerOptionsChanged(options: ts.CompilerOptions): void {
    const key = compilerOptionsKey(options);
    if (this.#hostOptionsKey !== undefined && this.#hostOptionsKey !== key) this.reset();
    this.#hostOptionsKey = key;
  }

  #sourceFile(fileName: string, create: () => ts.SourceFile | undefined, forceFresh: boolean): ts.SourceFile | undefined {
    const key = this.#canonicalPath(fileName);
    if (forceFresh) this.#sourceFileCache.delete(key);

    const cached = this.#sourceFileCache.get(key);
    const modifiedTime = sourceModifiedTime(fileName);
    if (cached !== undefined && cached.modifiedTime === modifiedTime) return cached.sourceFile;
    if (cached !== undefined) this.#sourceFileCache.delete(key);

    const sourceFile = create();
    if (sourceFile !== undefined) {
      this.#sourceFileCache.set(key, Object.freeze({
        sourceFile,
        ...(modifiedTime === undefined ? {} : { modifiedTime }),
      }));
    }
    return sourceFile;
  }

  #evictInvalidatedCompilerFiles(): readonly string[] {
    const changedSourceFiles = Object.freeze([...this.#changedSourceFiles]);
    for (const fileName of this.#invalidatedCompilerFiles) this.#sourceFileCache.delete(fileName);
    this.#changedSourceFiles.clear();
    this.#invalidatedCompilerFiles.clear();
    return changedSourceFiles;
  }

  #writeGeneratedApplication(context: CompilerContext, sourceFiles: readonly ts.SourceFile[], sourceHashes: ReadonlyMap<string, SourceHash>, runtimeOnly: boolean): Promise<void> {
    if (context.generatedApplication === undefined) return Promise.resolve();
    context.fingerprint = buildFingerprint(context.generatedApplication.files, sourceHashes);
    this.#markGeneratedArtifactsChanged(context.generatedApplication.files);
    context.applicationEntry = `${context.config.projectRoot}/.warbler/generated/build-${context.fingerprint}/application.generated.ts`;
    context.productionEntry = `${context.config.projectRoot}/.warbler/generated/production.generated.ts`;
    const snapshot = Object.freeze({
      fingerprint: context.fingerprint,
      sources: sourceFiles.map((source) =>
        Object.freeze({
          file: source.fileName,
          text: source.text,
        }),
      ),
    });
    return runtimeOnly
      ? writeRuntimeSnapshot(context.config.projectRoot, context.generatedApplication, snapshot)
      : writeArtifacts(context.config.projectRoot, context.generatedApplication, snapshot);
  }

  #sourceFilesByPath(sourceFiles: readonly ts.SourceFile[]): ReadonlyMap<string, ts.SourceFile> {
    return new Map(sourceFiles.map((source) => [this.#canonicalPath(source.fileName), source]));
  }

  #sourceSignatures(sourceFilesByPath: ReadonlyMap<string, ts.SourceFile>, changedFiles: readonly string[]): ReadonlyMap<string, string> {
    if (this.#warblerState === undefined || changedFiles.length === 0) {
      return new Map([...sourceFilesByPath].map(([fileName, source]) => [fileName, sourceMetadataSignature(source)]));
    }

    const signatures = new Map(this.#warblerState.sourceSignatures);
    for (const fileName of signatures.keys()) if (!sourceFilesByPath.has(fileName)) signatures.delete(fileName);
    for (const [fileName, source] of sourceFilesByPath) if (!signatures.has(fileName)) signatures.set(fileName, sourceMetadataSignature(source));
    for (const fileName of changedFiles) {
      const source = sourceFilesByPath.get(fileName);
      if (source === undefined) signatures.delete(fileName);
      else signatures.set(fileName, sourceMetadataSignature(source));
    }
    return signatures;
  }

  #sourceHashes(sourceFilesByPath: ReadonlyMap<string, ts.SourceFile>, changedFiles: readonly string[]): ReadonlyMap<string, SourceHash> {
    if (this.#warblerState === undefined || changedFiles.length === 0) {
      return new Map([...sourceFilesByPath].map(([fileName, source]) => [fileName, sourceHash(source)]));
    }

    const hashes = new Map(this.#warblerState.sourceHashes);
    for (const fileName of hashes.keys()) if (!sourceFilesByPath.has(fileName)) hashes.delete(fileName);
    for (const [fileName, source] of sourceFilesByPath) if (!hashes.has(fileName)) hashes.set(fileName, sourceHash(source));
    for (const fileName of changedFiles) {
      const source = sourceFilesByPath.get(fileName);
      if (source === undefined) hashes.delete(fileName);
      else hashes.set(fileName, sourceHash(source));
    }
    return hashes;
  }

  #classifySourceChange(changedFiles: readonly string[], sourceSignatures: ReadonlyMap<string, string>): SourceChangeKind {
    if (this.#warblerState === undefined) return "graph";
    if (changedFiles.length === 0) return sameSignatures(this.#warblerState.sourceSignatures, sourceSignatures) ? "code" : "graph";

    let changedApplicationFile = false;
    for (const fileName of changedFiles) {
      const previous = this.#warblerState.sourceSignatures.get(fileName);
      const current = sourceSignatures.get(fileName);
      if (previous === undefined && current === undefined) continue;
      changedApplicationFile = true;
      if (previous !== current) return current !== undefined && isGraphShapingSignature(current) ? "graph" : "metadata";
    }
    return changedApplicationFile ? "code" : "graph";
  }

  #markGeneratedArtifactsChanged(files: Readonly<Record<string, string>>): void {
    for (const fileName of Object.keys(files)) this.#invalidatedCompilerFiles.add(this.#canonicalPath(`.warbler/generated/${fileName}`));
  }

  #canonicalPath(fileName: string): string {
    const absolute = isAbsolute(fileName) ? fileName : resolve(this.#projectRoot, fileName);
    const normalized = ts.sys.resolvePath(absolute).replaceAll("\\", "/");
    return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
  }
}

interface CachedSourceFile {
  readonly sourceFile: ts.SourceFile;
  readonly modifiedTime?: number;
}

interface WarblerPipelineState {
  readonly applicationWIR: ApplicationWIR;
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly sourceSignatures: ReadonlyMap<string, string>;
  readonly sourceHashes: ReadonlyMap<string, SourceHash>;
  readonly generatedApplication?: GeneratedApplication;
}

interface SourceHash {
  readonly fileName: string;
  readonly hash: string;
}

/** Compiles a TypeScript project and returns its complete compiler context. */
export async function compileProject(
  projectRoot: string = process.cwd(),
  options: Readonly<CompileOptions> = {},
): Promise<CompilerContext> {
  return new Compiler(projectRoot).compile(options);
}

/** Compiles a TypeScript application and returns only its immutable WIR. */
export async function compileApplication(
  projectRoot: string = process.cwd(),
  options: Readonly<CompileOptions> = {},
): Promise<ApplicationWIR> {
  const context = await compileProject(projectRoot, options);

  return context.applicationWIR ?? Object.freeze({
    version: 1,
    projectRoot: context.config.projectRoot,
    transports: Object.freeze([]),
    middleware: Object.freeze([]),
    graphs: Object.freeze([]),
    rootProviders: Object.freeze([]),
    events: Object.freeze([]),
    eventListeners: Object.freeze([]),
    eventInterceptors: Object.freeze([]),
  });
}

function isApplicationSource(fileName: string, root: string): boolean {
  const normalized = fileName.replaceAll("\\", "/");
  const normalizedRoot = root.replaceAll("\\", "/");

  return normalized.startsWith(`${normalizedRoot}/`) &&
    !normalized.endsWith(".d.ts") &&
    !normalized.includes("/node_modules/") &&
    !normalized.includes("/dist/") &&
    !normalized.includes("/.warbler/generated/");
}

function isCompilerConfigurationPath(fileName: string): boolean {
  const normalized = fileName.replaceAll("\\", "/");

  return normalized === "tsconfig.json" ||
    normalized === "package.json" ||
    normalized.endsWith("/tsconfig.json") ||
    normalized.endsWith("/package.json");
}

function sourceModifiedTime(fileName: string): number | undefined {
  return ts.sys.getModifiedTime?.(fileName)?.getTime();
}

function compilerOptionsKey(options: ts.CompilerOptions): string {
  return JSON.stringify(Object.entries(options).sort(([left], [right]) => left.localeCompare(right)));
}

function sourceHash(source: ts.SourceFile): SourceHash {
  return Object.freeze({
    fileName: source.fileName,
    hash: Bun.hash(source.text).toString(16),
  });
}

function buildFingerprint(generated: Readonly<Record<string, string>>, sourceHashes: ReadonlyMap<string, SourceHash>): string {
  const generatedHashes = Object.entries(generated)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, content]) => [fileName, Bun.hash(content).toString(16)]);
  const sources = [...sourceHashes.values()]
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map((source) => [source.fileName, source.hash]);

  return Bun.hash(JSON.stringify({ generated: generatedHashes, sources })).toString(16);
}

function hasTypeScriptErrors(diagnostics: readonly CompilerDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.category === "error");
}

function sameSignatures(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [fileName, signature] of left) if (right.get(fileName) !== signature) return false;
  return true;
}

function isGraphShapingSignature(signature: string): boolean {
  return signature.includes("@Graph") ||
    signature.includes("@Controller") ||
    signature.includes("@SocketController") ||
    signature.includes("@Service") ||
    signature.includes("@Repository") ||
    signature.includes("@Factory") ||
    signature.includes("@Resolver") ||
    signature.includes("@Gateway") ||
    signature.includes("@Injectable") ||
    signature.includes("defineHttpGraph") ||
    signature.includes("defineWebSocketGraph") ||
    signature.includes("defineHandler") ||
    signature.includes("defineValidator") ||
    signature.includes("createApp") ||
    signature.includes("inject:");
}

function applicationRootNames(fileNames: readonly string[], projectRoot: string): readonly string[] {
  const roots = new Set(fileNames.map((fileName) => fileName.replaceAll("\\", "/")));
  for (const fileName of fileNames) {
    let text = "";
    try { text = readFileSync(fileName, "utf8"); } catch { continue; }
    if (!text.includes("createApp")) continue;
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const pattern of createAppGraphGlobs(source)) {
      for (const match of expandGraphGlob(projectRoot, pattern)) roots.add(match);
    }
  }
  return Object.freeze([...roots]);
}

function createAppGraphGlobs(source: ts.SourceFile): readonly string[] {
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callExpressionName(node.expression) === "createApp") {
      const object = node.arguments[0];
      if (object !== undefined && ts.isObjectLiteralExpression(object)) {
        const property = object.properties.find((item) => propertyName(item.name) === "graphs");
        if (property !== undefined && ts.isPropertyAssignment(property)) {
          const value = property.initializer;
          if (ts.isStringLiteralLike(value)) result.push(value.text);
          if (ts.isArrayLiteralExpression(value)) {
            for (const element of value.elements) if (ts.isStringLiteralLike(element)) result.push(element.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.freeze(result);
}

function expandGraphGlob(projectRoot: string, pattern: string): readonly string[] {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for (const fileName of glob.scanSync({ cwd: projectRoot, onlyFiles: true })) {
    if (!/\.[cm]?tsx?$/u.test(fileName) || /\.d\.[cm]?ts$/u.test(fileName)) continue;
    matches.push(`${projectRoot}/${fileName}`.replaceAll("\\", "/"));
  }
  return Object.freeze(matches);
}

function callExpressionName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function normalizeTypeScriptDiagnostic(input: ts.Diagnostic): CompilerDiagnostic {
  const source = input.file;
  const start = input.start ?? 0;
  const point = source?.getLineAndCharacterOfPosition(start);

  return Object.freeze({
    code: DiagnosticCode.PROJECT,
    category: input.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
    message: ts.flattenDiagnosticMessageText(input.messageText, "\n"),
    sourceFile: source?.fileName ?? "",
    line: (point?.line ?? 0) + 1,
    column: (point?.character ?? 0) + 1,
    relatedSymbols: Object.freeze([]),
  });
}

function projectDiagnostic(cause: unknown): CompilerDiagnostic {
  return Object.freeze({
    code: DiagnosticCode.PROJECT,
    category: "error",
    message: cause instanceof Error ? cause.message : "Unknown compiler failure.",
    sourceFile: "",
    line: 1,
    column: 1,
    relatedSymbols: Object.freeze([]),
  });
}
