import { Console } from "@warblerjs/console";
import type { CLIDiagnostic } from "./diagnostics";
/** CLI output sink, injectable for tests. */
export interface CLIOutput {
  write(message: string): void;
  error(message: string): void;
}
/** Default terminal output sink. */
export const terminalOutput: CLIOutput = Object.freeze({
  write(message: string): void { Console.raw(message); },
  error(message: string): void { Console.raw(message, true); },
});
/** Renders command success without mixing human and JSON formats. */
export function writeResult(output: CLIOutput, format: "human" | "json", value: Readonly<Record<string, unknown>>, human: string): void {
  output.write(format === "json" ? JSON.stringify(value) : human);
}
/** Renders one diagnostic in the selected format. */
export function writeDiagnostic(output: CLIOutput, format: "human" | "json", diagnostic: CLIDiagnostic, verboseDetail?: string): void {
  if (format === "json") { output.error(JSON.stringify(diagnostic)); return; }
  const location = diagnostic.file === undefined ? "" : `\n${diagnostic.file}${diagnostic.line === undefined ? "" : `:${diagnostic.line}:${diagnostic.column ?? 1}`}`;
  output.error(`${diagnostic.code} ${diagnostic.message}${location}${diagnostic.suggestion === undefined ? "" : `\n${diagnostic.suggestion}`}${verboseDetail === undefined ? "" : `\n${verboseDetail}`}`);
}
