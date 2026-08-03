import { ConfigError } from "../errors";

const DURATION_PATTERN = /^(0|[1-9]\d*)(ms|s|m|h)$/u;
const MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
});

/** Parses a canonical duration string into a safe integer number of milliseconds. */
export function parseDuration(value: unknown): number {
  if (typeof value !== "string") throw new ConfigError("duration must be a string");
  const match = DURATION_PATTERN.exec(value);
  if (match === null) throw new ConfigError("duration must use an integer followed by ms, s, m, or h");
  const amountText = match[1];
  const unit = match[2];
  if (amountText === undefined || unit === undefined) throw new ConfigError("invalid duration");
  const amount = Number(amountText);
  const multiplier = MULTIPLIERS[unit];
  if (multiplier === undefined || !Number.isSafeInteger(amount)) throw new ConfigError("duration is unsafe");
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds)) throw new ConfigError("duration exceeds the safe integer range");
  return milliseconds;
}
