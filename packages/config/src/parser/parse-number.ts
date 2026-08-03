import { ConfigError } from "../errors";

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

/** Parses a finite numeric value without accepting coercible or ambiguous input. */
export function parseNumber(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ConfigError("number must be finite");
    return value;
  }
  if (typeof value !== "string" || !NUMBER_PATTERN.test(value)) {
    throw new ConfigError("number must be a canonical decimal value");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ConfigError("number must be finite");
  return parsed;
}
