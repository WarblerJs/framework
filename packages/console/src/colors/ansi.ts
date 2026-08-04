export const ANSI = Object.freeze({
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
  white: "\u001b[97m",
  clearLine: "\u001b[2K",
  cursorUp: (lines: number): string => `\u001b[${lines}A`,
} as const);
export function paint(enabled: boolean, color: string, value: string): string {
  return enabled ? `${color}${value}${ANSI.reset}` : value;
}
