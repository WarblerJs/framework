import ts from "typescript";
import { analyzeProgram } from "../analyzer/analyze-program";
import { discoverProject, loadProjectConfig } from "../filesystem/discover-project";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostic";
import { validateApplication } from "../validation/validate-application";
import type { ApplicationWIR } from "../wir/wir";
import { CompilerContext } from "./compiler-context";
import { optimizeWIR } from "../optimizer/optimize-wir";
import { generateArtifacts, writeArtifacts } from "../generator/generate-artifacts";
import { analyzeExecutableBindings } from "../bindings";

/** Phase 1 compiler facade. One instance performs one project compilation at a time. */
export class Compiler {
  readonly #projectRoot: string;

  /** Creates a compiler rooted at the supplied application directory. */
  public constructor(projectRoot: string = process.cwd()) {
    this.#projectRoot = projectRoot;
  }

  /** Discovers, loads, analyzes, validates, and emits metadata-only WIR. */
  public async compile(): Promise<CompilerContext> {
    await Promise.resolve();
    try {
      const config = discoverProject(this.#projectRoot);
      const parsed = loadProjectConfig(config);
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        ...(parsed.projectReferences === undefined ? {} : { projectReferences: parsed.projectReferences }),
      });
      const sourceFiles = program.getSourceFiles().filter((source) => isApplicationSource(source.fileName, config.projectRoot));
      const diagnostics = [...parsed.errors, ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(normalizeTypeScriptDiagnostic);
      const context = new CompilerContext(program, sourceFiles, config, diagnostics);
      context.applicationWIR = validateApplication(config.projectRoot, analyzeProgram(context), context.diagnostics);
      const optimized = optimizeWIR(context.applicationWIR);
      const bindings = analyzeExecutableBindings(context, context.applicationWIR, optimized);
      if (bindings !== undefined) {
        context.generatedApplication = generateArtifacts(optimized, bindings);
        await writeArtifacts(config.projectRoot, context.generatedApplication);
        context.applicationEntry = `${config.projectRoot}/.warbler/generated/application.generated.ts`;
        context.productionEntry = `${config.projectRoot}/.warbler/generated/production.generated.ts`;
        context.fingerprint = Bun.hash(JSON.stringify(context.generatedApplication.files)).toString(16);
      }
      return context;
    } catch (cause) {
      const root = ts.sys.resolvePath(this.#projectRoot);
      const config = Object.freeze({ projectRoot: root, tsconfigPath: `${root}/tsconfig.json` });
      const program = ts.createProgram({ rootNames: [], options: { strict: true, noEmit: true } });
      const context = new CompilerContext(program, [], config, [projectDiagnostic(cause)]);
      context.applicationWIR = Object.freeze({ version: 1, projectRoot: config.projectRoot, graphs: Object.freeze([]), rootProviders: Object.freeze([]) });
      return context;
    }
  }
}

/** Compiles a TypeScript project and returns its complete compiler context. */
export async function compileProject(projectRoot: string = process.cwd()): Promise<CompilerContext> {
  return new Compiler(projectRoot).compile();
}

/** Compiles a TypeScript application and returns only its immutable WIR. */
export async function compileApplication(projectRoot: string = process.cwd()): Promise<ApplicationWIR> {
  const context = await compileProject(projectRoot);
  return context.applicationWIR ?? Object.freeze({ version: 1, projectRoot: context.config.projectRoot, graphs: Object.freeze([]), rootProviders: Object.freeze([]) });
}

function isApplicationSource(fileName: string, root: string): boolean {
  const normalized = fileName.replaceAll("\\", "/");
  const normalizedRoot = root.replaceAll("\\", "/");
  return normalized.startsWith(`${normalizedRoot}/`) &&
    !normalized.endsWith(".d.ts") &&
    !normalized.includes("/node_modules/") &&
    !normalized.includes("/dist/") &&
    !normalized.includes("/generated/");
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
