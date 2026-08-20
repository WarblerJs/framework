import ts from "typescript";
import { isAbsolute, resolve } from "node:path";
import { Console, createCorrelationId } from "@warbler/console";
import { analyzeProgram } from "../analyzer/analyze-program";
import { discoverProject, loadProjectConfig } from "../filesystem/discover-project";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostic";
import { validateApplication } from "../validation/validate-application";
import type { ApplicationWIR } from "../wir/wir";
import { CompilerContext } from "./compiler-context";
import { optimizeWIR } from "../optimizer/optimize-wir";
import { generateArtifacts, writeArtifacts } from "../generator/generate-artifacts";
import { analyzeContextBindings, analyzeExecutableBindings } from "../bindings";

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
  readonly #changedFiles = new Set<string>();

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

    this.#changedFiles.add(this.#canonicalPath(fileName));
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
    this.#changedFiles.clear();
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
      this.#evictChangedFiles();
      const host = this.#compilerHost(parsed.options);
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
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

      if (bindings !== undefined) {
        const contextEntries = analyzeContextBindings(context, optimized);

        context.generatedApplication = generateArtifacts(
          optimized,
          bindings,
          contextEntries,
        );

        context.fingerprint = Bun.hash(
          JSON.stringify({
            generated: context.generatedApplication.files,
            sources: sourceFiles.map((source) => [source.fileName, source.text]),
          }),
        ).toString(16);

        await writeArtifacts(config.projectRoot, context.generatedApplication, {
          fingerprint: context.fingerprint,
          sources: sourceFiles.map((source) =>
            Object.freeze({
              file: source.fileName,
              text: source.text,
            }),
          ),
        });
        this.#markGeneratedArtifactsChanged(context.generatedApplication.files);

        context.applicationEntry = `${config.projectRoot}/.warbler/generated/build-${context.fingerprint}/application.generated.ts`;
        context.productionEntry = `${config.projectRoot}/.warbler/generated/production.generated.ts`;
      }

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

  #evictChangedFiles(): void {
    for (const fileName of this.#changedFiles) this.#sourceFileCache.delete(fileName);
    this.#changedFiles.clear();
  }

  #markGeneratedArtifactsChanged(files: Readonly<Record<string, string>>): void {
    for (const fileName of Object.keys(files)) this.#changedFiles.add(this.#canonicalPath(`.warbler/generated/${fileName}`));
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
