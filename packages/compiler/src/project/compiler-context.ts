import type ts from "typescript";
import type { CompilerConfig } from "../config/compiler-config";
import type { CompilerDiagnostic } from "../diagnostics/diagnostic";
import type { ApplicationWIR } from "../wir/wir";
import type { GeneratedApplication } from "../output/artifact-types";

/** All state owned by one compiler invocation. */
export class CompilerContext {
  /** TypeScript Program created exactly once. */
  public readonly program: ts.Program;
  /** TypeChecker created exactly once. */
  public readonly typeChecker: ts.TypeChecker;
  /** Application source files, excluding declarations and dependencies. */
  public readonly sourceFiles: readonly ts.SourceFile[];
  /** Normalized compiler configuration. */
  public readonly config: Readonly<CompilerConfig>;
  /** Accumulated normalized diagnostics. */
  public readonly diagnostics: CompilerDiagnostic[];
  /** Generated immutable WIR, when analysis completed. */
  public applicationWIR: ApplicationWIR | undefined;
  /** Optimized tables and deterministic generated source files. */
  public generatedApplication: GeneratedApplication | undefined;

  /** Creates a context from already discovered project state. */
  public constructor(program: ts.Program, sourceFiles: readonly ts.SourceFile[], config: Readonly<CompilerConfig>, diagnostics: CompilerDiagnostic[] = []) {
    this.program = program;
    this.typeChecker = program.getTypeChecker();
    this.sourceFiles = Object.freeze([...sourceFiles]);
    this.config = config;
    this.diagnostics = diagnostics;
  }
}
