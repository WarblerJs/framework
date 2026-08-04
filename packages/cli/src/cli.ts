import type { DevelopmentRuntimeLauncher } from "./dev/dev-session";
import type { DevSession } from "./dev/dev-session";
import { devCommand } from "./dev/dev-command";
import { ApplicationEntryRuntimeLauncher } from "./dev/runtime-launcher";
import { buildCommand } from "./build/build-command";
import { cleanCommand } from "./clean/clean-command";
import { cliDiagnostic } from "./diagnostics";
import { doctorCommand } from "./doctor/doctor-command";
import { CLIError } from "./errors";
import { generateSource } from "./generate/generate-command";
import { inspectCommand } from "./inspect/inspect-command";
import { createStarterProject } from "./new/new-command";
import { terminalOutput, writeDiagnostic, writeResult, type CLIOutput } from "./output";
import { parseCLI } from "./parser";
import { locateProject, validateProject } from "./project";
import { startCommand } from "./start/start-command";
import { ExitCode, type CLIContext } from "./types";

/** Injectable CLI orchestration services. */
export interface CLIServices {
  readonly cwd?: string;
  readonly output?: CLIOutput;
  readonly runtimeLauncher?: DevelopmentRuntimeLauncher;
  readonly waitForDevSession?: boolean;
  readonly onDevSession?: (session: DevSession) => void;
}

/** Runs one CLI invocation inside a safe diagnostic boundary. */
export async function runCLI(argv: readonly string[], services: CLIServices = {}): Promise<number> {
  const output = services.output ?? terminalOutput;
  let format: "human" | "json" = argv.includes("--json") ? "json" : "human";
  let verbose = argv.includes("--verbose");
  try {
    const parsed = parseCLI(argv);
    if (parsed.flags.help === true) return runCLI(["help", ...(parsed.flags.json === true ? ["--json"] : [])], services);
    format = parsed.flags.json === true ? "json" : "human";
    verbose = parsed.flags.verbose === true;
    const cwd = services.cwd ?? process.cwd();
    const needsProject = !["help", "version", "new"].includes(parsed.command);
    const projectRoot = needsProject ? await locateProject(cwd, stringFlag(parsed.flags.project)) : undefined;
    const context: CLIContext = Object.freeze({
      ...parsed, cwd, ...(projectRoot === undefined ? {} : { projectRoot }), format, verbose,
    });
    validateCommandFlags(context);
    const commandOutput = context.flags.quiet === true && context.format === "human"
      ? Object.freeze({ write(_message: string): void {}, error(message: string): void { output.error(message); } })
      : output;
    return await execute(context, commandOutput, services);
  } catch (cause) {
    const known = cause instanceof CLIError;
    const diagnostic = known
      ? cliDiagnostic({ code: cause.code, severity: "error", message: cause.message, ...(cause.suggestion === undefined ? {} : { suggestion: cause.suggestion }) })
      : cliDiagnostic({ code: "CLI9000", severity: "error", message: "Unexpected CLI failure." });
    writeDiagnostic(output, format, diagnostic, verbose && cause instanceof Error ? cause.stack : undefined);
    return known ? cause.exitCode : ExitCode.FAILURE;
  }
}

async function execute(context: CLIContext, output: CLIOutput, services: CLIServices): Promise<number> {
  switch (context.command) {
    case "help":
      assertArgs(context, 0);
      writeResult(output, context.format, { command: "help", status: "success", text: HELP }, HELP);
      return ExitCode.SUCCESS;
    case "version":
      assertArgs(context, 0);
      writeResult(output, context.format, { command: "version", status: "success", version: "0.1.0" }, "Warbler CLI 0.1.0");
      return ExitCode.SUCCESS;
    case "new": {
      assertArgs(context, 1);
      const root = await createStarterProject(context.cwd, context.args[0], context.flags["dry-run"] === true);
      writeResult(output, context.format, { command: "new", status: "success", project: root, dryRun: context.flags["dry-run"] === true }, `Created Warbler application: ${root}`);
      return ExitCode.SUCCESS;
    }
  }
  const root = context.projectRoot!;
  if (context.command === "generate") {
    assertArgs(context, 2);
    await validateProject(root);
    const plan = await generateSource(root, context.args[0], context.args[1], { force: context.flags.force === true, dryRun: context.flags["dry-run"] === true });
    writeResult(output, context.format, { command: "generate", status: "success", file: plan.path, dryRun: context.flags["dry-run"] === true }, `${context.flags["dry-run"] === true ? "Would generate" : "Generated"} ${plan.path}`);
    return ExitCode.SUCCESS;
  }
  const layout = await validateProject(root);
  switch (context.command) {
    case "dev": {
      assertArgs(context, 0);
      const session = await devCommand(
        root,
        services.runtimeLauncher ?? new ApplicationEntryRuntimeLauncher(),
        context.flags["no-watch"] !== true,
        {
          ...(stringFlag(context.flags.host) === undefined ? {} : { host: stringFlag(context.flags.host)! }),
          ...(stringFlag(context.flags.port) === undefined ? {} : { port: stringFlag(context.flags.port)! }),
          ...(stringFlag(context.flags.mode) === undefined ? {} : { mode: stringFlag(context.flags.mode)! }),
        },
      );
      services.onDevSession?.(session);
      writeResult(output, context.format, { command: "dev", status: "success", project: root, watching: context.flags["no-watch"] !== true }, `Warbler development session started.\nProject: ${root}`);
      if (services.waitForDevSession ?? true) await session.wait();
      return ExitCode.SUCCESS;
    }
    case "build": {
      assertArgs(context, 0);
      const out = stringFlag(context.flags.out);
      const result = await buildCommand(layout, {
        ...(out === undefined ? {} : { out }),
        minify: context.flags.minify === true,
        sourcemap: context.flags.sourcemap === true,
      });
      writeResult(output, context.format, { command: "build", status: "success", entry: result.entry }, `Built ${result.entry}`);
      return ExitCode.SUCCESS;
    }
    case "start": return startCommand(layout, context.args);
    case "doctor": {
      assertArgs(context, 0);
      const diagnostics = await doctorCommand(layout);
      if (context.format === "json") output.write(JSON.stringify({ command: "doctor", status: diagnostics.some((item) => item.severity === "error") ? "failure" : "success", diagnostics }));
      else for (const diagnostic of diagnostics) (diagnostic.severity === "error" ? output.error : output.write)(`${diagnostic.code} ${diagnostic.message}`);
      return diagnostics.some((item) => item.severity === "error") ? ExitCode.INVALID_PROJECT : ExitCode.SUCCESS;
    }
    case "inspect": {
      if (context.args.length > 1) throw new CLIError("CLI1008", "inspect accepts at most one section.", ExitCode.INVALID_ARGUMENTS);
      const result = await inspectCommand(layout, context.args[0]);
      writeResult(output, context.format, { command: "inspect", status: "success", ...result }, `Graphs:      ${result.graphs}\nProviders:   ${result.providers}\nHTTP routes: ${result.routes}\nSocket events: ${result.socketEvents}`);
      return ExitCode.SUCCESS;
    }
    case "clean":
      assertArgs(context, 0);
      await cleanCommand(root);
      writeResult(output, context.format, { command: "clean", status: "success" }, "Removed dist/ and .warbler/.");
      return ExitCode.SUCCESS;
    default: throw new CLIError("CLI1001", `Unsupported command: ${context.command}`, ExitCode.INVALID_ARGUMENTS);
  }
}
function assertArgs(context: CLIContext, count: number): void {
  if (context.args.length !== count) throw new CLIError("CLI1009", `${context.command} expects ${count} positional argument(s).`, ExitCode.INVALID_ARGUMENTS);
}
function stringFlag(value: string | boolean | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
function validateCommandFlags(context: CLIContext): void {
  const common = ["json", "verbose", "quiet", "help"];
  const commandFlags: Readonly<Record<CLIContext["command"], readonly string[]>> = {
    dev: [...common, "project", "mode", "host", "port", "watch", "no-watch"],
    build: [...common, "project", "out", "minify", "sourcemap"],
    start: [...common, "project"],
    doctor: [...common, "project"],
    inspect: [...common, "project"],
    new: [...common, "dry-run"],
    generate: [...common, "project", "dry-run", "force"],
    clean: [...common, "project"],
    version: common,
    help: common,
  };
  const allowed = new Set(commandFlags[context.command]);
  for (const flag of Object.keys(context.flags)) if (!allowed.has(flag)) throw new CLIError("CLI1010", `Flag --${flag} is not supported by ${context.command}.`, ExitCode.INVALID_ARGUMENTS);
}

const HELP = `Warbler CLI

Usage:
  warbler dev [--no-watch]
  warbler build [--out dist] [--minify] [--sourcemap]
  warbler start
  warbler doctor
  warbler inspect [graphs|routes|providers|transports|config]
  warbler new <name>
  warbler generate <kind> <name>
  warbler clean
  warbler version

Exit codes: 0 success, 1 failure, 2 arguments, 3 project/config, 4 dependency,
5 runtime, 6 filesystem, 7 process.`;
