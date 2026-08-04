import type { ConsoleOptions } from "../types";

export interface TerminalCapabilities {
  readonly color: boolean;
  readonly unicode: boolean;
  readonly dynamic: boolean;
}
export function terminalCapabilities(options: ConsoleOptions): TerminalCapabilities {
  const environment = options.environment ?? process.env;
  const tty = options.stdout?.isTTY ?? Boolean(process.stdout.isTTY);
  const human = (options.mode ?? "human") === "human";
  return Object.freeze({
    color: human && tty && options.color !== false && environment.NO_COLOR === undefined && environment.TERM !== "dumb",
    unicode: human && options.unicode !== false && environment.TERM !== "dumb",
    dynamic: human && tty,
  });
}
