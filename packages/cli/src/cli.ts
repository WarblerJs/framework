import type { DevelopmentRuntimeLauncher } from "./dev/dev-session";
import { CLI_VERSION, resolveProjectFrameworkVersion } from "./version";
import { Console } from "@warblerjs/console";
import { isDatabaseError } from "@warblerjs/database";
import type { DevSession } from "./dev/dev-session";
import type { DevelopmentEvent, DevelopmentReporter } from "./dev/dev-session";
import { devCommand } from "./dev/dev-command";
import { ApplicationEntryRuntimeLauncher } from "./dev/runtime-launcher";
import { buildCommand } from "./build/build-command";
import { cleanCommand } from "./clean/clean-command";
import { cliDiagnostic } from "./diagnostics";
import { databaseGenerateCommand } from "./db/generate-command";
import { migrationRollbackCommand, migrationRunCommand, migrationScaffoldCommand } from "./db/migration-command";
import { migrateFreshCommand } from "./db/reset-command";
import { seedRunCommand, seedScaffoldCommand } from "./db/seed-command";
import { doctorCommand } from "./doctor/doctor-command";
import { CLIError } from "./errors";
import { generateSource } from "./generate/generate-command";
import { inspectCommand } from "./inspect/inspect-command";
import { makeGraphCommand } from "./make/make-graph-command";
import { createStarterProject } from "./new/new-command";
import { terminalOutput, writeDiagnostic, writeResult, type CLIOutput } from "./output";
import { parseCLI } from "./parser";
import { locateProject, validateProject } from "./project";
import { startCommand } from "./start/start-command";
import { ExitCode, type CLIContext } from "./types";
import { basename } from "node:path";

/** Injectable CLI orchestration services. */
export interface CLIServices {
  readonly cwd?: string;
  readonly output?: CLIOutput;
  readonly runtimeLauncher?: DevelopmentRuntimeLauncher;
  readonly waitForDevSession?: boolean;
  readonly onDevSession?: (session: DevSession) => void;
  readonly confirm?: (message: string) => boolean | Promise<boolean>;
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
    Console.configure({
      mode: format,
      color: parsed.flags["no-color"] !== true,
      unicode: true,
      silent: parsed.flags.quiet === true,
      verbose,
      stdout: services.output === undefined ? process.stdout : { write: (message) => services.output!.write(message.trimEnd()), isTTY: false },
      stderr: services.output === undefined ? process.stderr : { write: (message) => services.output!.error(message.trimEnd()), isTTY: false },
      environment: process.env,
    });
    const cwd = services.cwd ?? process.cwd();
    const needsProject = !["help", "version", "new"].includes(parsed.command);
    const projectRoot = needsProject ? await locateProject(cwd, stringFlag(parsed.flags.project)) : undefined;
    const context: CLIContext = Object.freeze({
      ...parsed, cwd, ...(projectRoot === undefined ? {} : { projectRoot }), format, verbose,
    });
    validateCommandFlags(context);
    const color = context.format === "human" && context.flags["no-color"] !== true && process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);
    const renderedOutput = color ? colorOutput(output) : output;
    const commandOutput = context.flags.quiet === true && context.format === "human"
      ? Object.freeze({ write(_message: string): void {}, error(message: string): void { output.error(message); } })
      : renderedOutput;
    return await execute(context, commandOutput, services);
  } catch (cause) {
    const known = cause instanceof CLIError;
    const database = isDatabaseError(cause);

    const diagnostic = known
      ? cliDiagnostic({ code: cause.code, severity: "error", message: cause.message, ...(cause.suggestion === undefined ? {} : { suggestion: cause.suggestion }) })
      : database
        ? cliDiagnostic({ code: cause.code, severity: "error", message: cause.message })
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
        writeResult(
          output,
          context.format,
          {
            command: "version",
            status: "success",
            version: CLI_VERSION,
          },
          `Warbler CLI ${CLI_VERSION}`,
        );
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
  if (context.command === "make:graph") {
    assertArgs(context, 1);
    const result = await makeGraphCommand(context);
    writeResult(
      output,
      context.format,
      { command: "make:graph", status: "success", ...result },
      `${context.flags["dry-run"] === true ? "Would generate" : "Generated"} graph ${result.graphName} (${result.architecture}, ${result.transports.join(",")})`,
    );
    return ExitCode.SUCCESS;
  }
  const layout = await validateProject(root);
  switch (context.command) {
    case "dev": {
      assertArgs(context, 0);
      const frameworkVersion = await resolveProjectFrameworkVersion(root);
      const report: DevelopmentReporter = (event) => writeDevelopmentEvent(output, context.format, context.verbose, event);
      report(Object.freeze({
        stage: "project",
        status: "success",
        message: "Project discovered and structure validated.",
        metadata: Object.freeze({ project: root }),
      }));
      const session = await devCommand(
        root,
        services.runtimeLauncher ?? new ApplicationEntryRuntimeLauncher(),
        context.flags["no-watch"] !== true,
        {
          ...(stringFlag(context.flags.host) === undefined ? {} : { host: stringFlag(context.flags.host)! }),
          ...(stringFlag(context.flags.port) === undefined ? {} : { port: stringFlag(context.flags.port)! }),
          ...(stringFlag(context.flags.mode) === undefined ? {} : { mode: stringFlag(context.flags.mode)! }),
        },
        report,
      );
      services.onDevSession?.(session);
      Console.banner({
        frameworkVersion,
        cliVersion: CLI_VERSION,
        project: basename(root),
        build: session.buildNumber,
        ...(session.network === undefined ? {} : { network: session.network }),
        ...(context.flags["no-watch"] === true ? {} : { watching: Object.freeze(["src", "resources", "public"]) }),
      });
      writeResult(
        output,
        context.format,
        { command: "dev", status: "success", project: root, watching: context.flags["no-watch"] !== true, runtime: "running" },
        `Warbler development Runtime is running.\nProject: ${root}\n${context.flags["no-watch"] === true ? "Filesystem watcher disabled." : "Watching for changes..."}`,
      );
      if (services.waitForDevSession ?? true) await session.wait();
      return ExitCode.SUCCESS;
    }
    case "build": {
      assertArgs(context, 0);
      const out = stringFlag(context.flags.out);
      const result = await buildCommand(layout, {
        ...(out === undefined ? {} : { out }),
        ...(context.flags["no-minify"] === true ? { minify: false } : context.flags.minify === true ? { minify: true } : {}),
        ...(context.flags["no-sourcemap"] === true ? { sourcemap: false } : context.flags.sourcemap === true ? { sourcemap: true } : {}),
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
      writeResult(output, context.format, { command: "inspect", status: "success", ...result }, `Graphs:      ${result.graphs}\nProviders:   ${result.providers}\nControllers: ${result.controllers}\nHandlers:    ${result.handlers}\nGuards:      ${result.guards}\nValidators:  ${result.validators}\nHTTP routes: ${result.routes}\nSocket events: ${result.socketEvents}`);
      return ExitCode.SUCCESS;
    }
    case "clean":
      assertArgs(context, 0);
      await cleanCommand(root, context.flags["dry-run"] === true);
      writeResult(output, context.format, { command: "clean", status: "success", dryRun: context.flags["dry-run"] === true }, context.flags["dry-run"] === true ? "Would remove dist/ and .warbler/." : "Removed dist/ and .warbler/.");
      return ExitCode.SUCCESS;
    case "db:pg": {
      assertArgs(context, [1, 2]);
      const [action, target] = context.args;
      if (action === "generate") {
        assertArgs(context, 1);
        const result = await databaseGenerateCommand(layout);
        writeResult(
          output,
          context.format,
          { command: "db:pg", status: "success", action: "generate", tables: result.tables, fingerprint: result.fingerprint },
          `Compiled ${result.tables.length} table(s): ${result.tables.join(", ")}`,
        );
        return ExitCode.SUCCESS;
      }
      if (action === "migration") {
        if (target === undefined) {
          const result = await migrationRunCommand(layout);
          const message = result.executed.length === 0
            ? "No pending migrations."
            : result.executed.map((migration) => `${migration.name} (batch ${migration.batch}, ${migration.executionMs}ms)`).join("\n");
          writeResult(output, context.format, { command: "db:pg", status: "success", action: "migration", executed: result.executed }, message);
          return ExitCode.SUCCESS;
        }
        const scaffold = await migrationScaffoldCommand(layout, target, context.flags["no-soft-delete"] === true ? { softDelete: false } : {});
        writeResult(output, context.format, { command: "db:pg", status: "success", action: "migration", file: scaffold.path }, `Generated ${scaffold.path}`);
        return ExitCode.SUCCESS;
      }
      if (action === "rollback") {
        assertArgs(context, 1);
        const result = await migrationRollbackCommand(layout, { step: parseRollbackStep(stringFlag(context.flags.step)) });
        const message = result.rolledBack.length === 0
          ? "Nothing to rollback."
          : result.rolledBack.map((migration) => `${migration.name} (batch ${migration.batch}, ${migration.executionMs}ms)`).join("\n");
        writeResult(output, context.format, { command: "db:pg", status: "success", action: "rollback", rolledBack: result.rolledBack }, message);
        return ExitCode.SUCCESS;
      }
      if (action === "migrate:fresh") {
        assertArgs(context, 1);
        const confirmed = await confirmAction(context, output, services, context.flags.seed === true
          ? "This will rebuild the PostgreSQL database, run migrations, and execute all seed files."
          : "This will rebuild the PostgreSQL database and run migrations.");
        if (!confirmed) {
          writeResult(output, context.format, { command: "db:pg", status: "cancelled", action: "migrate:fresh" }, "PostgreSQL migrate:fresh cancelled.");
          return ExitCode.SUCCESS;
        }
        const result = await migrateFreshCommand(layout, { seed: context.flags.seed === true });
        const message = [
          result.executed.length === 0 ? "No migrations to run." : result.executed.map((migration) => `${migration.name} (batch ${migration.batch}, ${migration.executionMs}ms)`).join("\n"),
          ...(result.seeded.length === 0 ? [] : [`Seeded: ${result.seeded.map((seed) => `${seed.name} (batch ${seed.batch})`).join(", ")}`]),
        ].join("\n");
        writeResult(output, context.format, { command: "db:pg", status: "success", action: "migrate:fresh", executed: result.executed, seeded: result.seeded }, message);
        return ExitCode.SUCCESS;
      }
      if (action === "seed:make") {
        if (target === undefined) throw new CLIError("CLI3007", "db:pg seed:make requires a seed name.", ExitCode.INVALID_ARGUMENTS);
        const scaffold = await seedScaffoldCommand(layout, target);
        writeResult(output, context.format, { command: "db:pg", status: "success", action: "seed:make", file: scaffold.path }, `Generated ${scaffold.path}`);
        return ExitCode.SUCCESS;
      }
      if (action === "seed:run") {
        assertArgs(context, 1);
        const result = await seedRunCommand(layout, {
          ...(stringFlag(context.flags.only) === undefined ? {} : { only: stringFlag(context.flags.only)! }),
          confirm: (pending) => confirmAction(context, output, services, [
            "The following pending PostgreSQL seeds will be executed:",
            "",
            pending.join("\n"),
          ].join("\n")),
        });
        const message = result.canceled
          ? "PostgreSQL seed run cancelled."
          : result.alreadyExecuted !== undefined
            ? `Seed "${result.alreadyExecuted}" has already been executed.`
            : result.executed.length === 0
              ? "No pending seeds."
              : result.executed.map((seed) => `${seed.name} (batch ${seed.batch})`).join("\n");
        writeResult(output, context.format, { command: "db:pg", status: result.canceled ? "cancelled" : "success", action: "seed:run", executed: result.executed, skipped: result.skipped, pending: result.pending }, message);
        return ExitCode.SUCCESS;
      }
      throw new CLIError("CLI3002", `Unknown db:pg action: ${action ?? ""}`, ExitCode.INVALID_ARGUMENTS, "Run warbler db:pg generate, migration, rollback, migrate:fresh, seed:make, or seed:run.");
    }
    default: throw new CLIError("CLI1001", `Unsupported command: ${context.command}`, ExitCode.INVALID_ARGUMENTS);
  }
}
function writeDevelopmentEvent(output: CLIOutput, format: "human" | "json", verbose: boolean, event: DevelopmentEvent): void {
  if (!verbose && event.status === "started") return;
  if (format === "json") {
    output.write(JSON.stringify({ command: "dev", type: "stage", ...event }));
    return;
  }
  const marker = event.status === "success" ? "✓" : event.status === "failure" ? "✗" : event.status === "skipped" ? "–" : "•";
  const message = `${marker} ${event.message}`;
  (event.status === "failure" ? output.error : output.write)(message);
}
function assertArgs(context: CLIContext, count: number | readonly [min: number, max: number]): void {
  if (Array.isArray(count)) {
    const [min, max] = count;
    if (context.args.length < min || context.args.length > max) {
      throw new CLIError("CLI1009", `${context.command} expects between ${min} and ${max} positional argument(s).`, ExitCode.INVALID_ARGUMENTS);
    }
    return;
  }
  if (context.args.length !== count) throw new CLIError("CLI1009", `${context.command} expects ${count} positional argument(s).`, ExitCode.INVALID_ARGUMENTS);
}
function stringFlag(value: string | boolean | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
async function confirmAction(context: CLIContext, output: CLIOutput, services: CLIServices, message: string): Promise<boolean> {
  if (services.confirm !== undefined) return await services.confirm(`${message}\n\nContinue? (y/N)`);
  if (context.format === "json" || !process.stdin.isTTY) return false;
  output.write(`${message}\n\nContinue? (y/N)`);
  const answer = prompt("");
  return answer?.toLowerCase() === "y" || answer?.toLowerCase() === "yes";
}
function parseRollbackStep(value: string | undefined): number {
  if (value === undefined) return 1;
  if (!/^[1-9]\d*$/u.test(value)) throw new CLIError("CLI3004", "Rollback step must be a positive safe integer.", ExitCode.INVALID_ARGUMENTS);
  const step = Number(value);
  if (!Number.isSafeInteger(step)) throw new CLIError("CLI3004", "Rollback step must be a positive safe integer.", ExitCode.INVALID_ARGUMENTS);
  return step;
}
function validateCommandFlags(context: CLIContext): void {
  const common = ["json", "verbose", "quiet", "help", "no-color"];
  const commandFlags: Readonly<Record<CLIContext["command"], readonly string[]>> = {
    dev: [...common, "project", "mode", "host", "port", "watch", "no-watch"],
    build: [...common, "project", "out", "minify", "no-minify", "sourcemap", "no-sourcemap"],
    start: [...common, "project"],
    doctor: [...common, "project"],
    inspect: [...common, "project"],
    new: [...common, "dry-run"],
    "make:graph": [...common, "project", "architecture", "transport", "dry-run"],
    generate: [...common, "project", "dry-run", "force"],
    "db:pg": [...common, "project", "seed", "step", "only", "no-soft-delete"],
    clean: [...common, "project", "dry-run"],
    version: common,
    help: common,
  };
  const allowed = new Set(commandFlags[context.command]);
  for (const flag of Object.keys(context.flags)) if (!allowed.has(flag)) throw new CLIError("CLI1010", `Flag --${flag} is not supported by ${context.command}.`, ExitCode.INVALID_ARGUMENTS);
}
function colorOutput(output: CLIOutput): CLIOutput {
  const reset = "\u001b[0m";
  return Object.freeze({
    write(message: string): void { output.write(`\u001b[32m${message}${reset}`); },
    error(message: string): void { output.error(`\u001b[31m${message}${reset}`); },
  });
}

const HELP = `Warbler CLI

Usage:
  warbler dev [--no-watch]
  warbler build [--out dist] [--minify] [--sourcemap]
  warbler start
  warbler doctor
  warbler inspect [graphs|routes|providers|transports|config]
  warbler new <name>
  warbler make:graph <name> [-a minimal|hexagonal|clean|mvc] [-t http|socket|http,socket]
  warbler db:pg migration [<kind>:<name>] [--no-soft-delete]
  warbler db:pg rollback [--step 3]
  warbler db:pg generate
  warbler db:pg migrate:fresh [--seed]
  warbler db:pg seed:make <name>
  warbler db:pg seed:run [--only <name>]
  warbler clean
  warbler version

Exit codes: 0 success, 1 failure, 2 arguments, 3 project/config, 4 dependency,
5 runtime, 6 filesystem, 7 process.`;
