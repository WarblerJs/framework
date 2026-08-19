import { CLIError } from "./errors";
import { ExitCode, type CLICommandName, type CLIFlagValue, type ParsedCLI } from "./types";

const COMMANDS = new Set<CLICommandName>(["dev", "build", "start", "doctor", "inspect", "new", "generate", "db:pg", "clean", "version", "help"]);
const VALUE_FLAGS = new Set(["project", "mode", "host", "port", "out", "step", "only"]);
const BOOLEAN_FLAGS = new Set(["watch", "no-watch", "minify", "no-minify", "sourcemap", "no-sourcemap", "no-color", "json", "verbose", "quiet", "dry-run", "force", "seed", "help"]);

/** Parses CLI arguments without mutating input or retaining global state. */
export function parseCLI(input: readonly string[]): ParsedCLI {
  const tokens = [...input];
  if (tokens.length === 0 || tokens[0] === "--help" || tokens[0] === "-h") return freeze("help", [], {});
  if (tokens[0] === "--version" || tokens[0] === "-v") return freeze("version", [], {});
  const command = tokens.shift();
  if (command === undefined || !COMMANDS.has(command as CLICommandName)) throw new CLIError("CLI1001", `Unknown command: ${command ?? ""}`, ExitCode.INVALID_ARGUMENTS, "Run warbler help.");
  const flags: Record<string, CLIFlagValue> = Object.create(null);
  const args: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) { args.push(token); continue; }
    const equal = token.indexOf("=");
    const name = token.slice(2, equal === -1 ? undefined : equal);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) throw new CLIError("CLI1002", `Unknown flag: --${name}`, ExitCode.INVALID_ARGUMENTS);
    if (name in flags) throw new CLIError("CLI1003", `Duplicate flag: --${name}`, ExitCode.INVALID_ARGUMENTS);
    if (VALUE_FLAGS.has(name)) {
      const value = equal === -1 ? tokens[++index] : token.slice(equal + 1);
      if (value === undefined || value === "" || value.startsWith("--")) throw new CLIError("CLI1004", `Flag --${name} requires a value.`, ExitCode.INVALID_ARGUMENTS);
      if (name === "port" && (!/^[1-9]\d*$/u.test(value) || Number(value) > 65_535)) throw new CLIError("CLI1005", "Port must be between 1 and 65535.", ExitCode.INVALID_ARGUMENTS);
      flags[name] = value;
    } else {
      if (equal !== -1) throw new CLIError("CLI1006", `Boolean flag --${name} does not accept a value.`, ExitCode.INVALID_ARGUMENTS);
      flags[name] = true;
    }
  }
  if (flags.watch === true && flags["no-watch"] === true) throw new CLIError("CLI1007", "--watch conflicts with --no-watch.", ExitCode.INVALID_ARGUMENTS);
  if (flags.minify === true && flags["no-minify"] === true) throw new CLIError("CLI1007", "--minify conflicts with --no-minify.", ExitCode.INVALID_ARGUMENTS);
  if (flags.sourcemap === true && flags["no-sourcemap"] === true) throw new CLIError("CLI1007", "--sourcemap conflicts with --no-sourcemap.", ExitCode.INVALID_ARGUMENTS);
  return freeze(command as CLICommandName, args, flags);
}
function freeze(command: CLICommandName, args: readonly string[], flags: Record<string, CLIFlagValue>): ParsedCLI {
  return Object.freeze({ command, args: Object.freeze([...args]), flags: Object.freeze(flags) });
}
