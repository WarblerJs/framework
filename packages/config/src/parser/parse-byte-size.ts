import { ConfigError } from "../errors";

const BYTE_SIZE_PATTERN = /^(0|[1-9]\d*)(b|kb|mb|gb)$/u;
const MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
});

/**
 * Parses a canonical byte-size string into a safe integer number of bytes.
 *
 * A byte-size limit of `0` is never a valid *limit* — it either silently disables the field it
 * guards or rejects every request, and both outcomes must be an explicit config decision, not a
 * value that happens to parse. `minimumBytes` therefore defaults to `1`; pass `0` explicitly only
 * for the rare field where a zero-byte value is a genuine, intentional setting.
 */
export function parseByteSize(value: unknown, minimumBytes = 1): number {
  if (!Number.isSafeInteger(minimumBytes) || minimumBytes < 0) {
    throw new ConfigError("byte size minimum must be a non-negative safe integer");
  }
  if (typeof value !== "string") throw new ConfigError("byte size must be a string");
  const match = BYTE_SIZE_PATTERN.exec(value);
  if (match === null) throw new ConfigError("byte size must use a positive integer followed by b, kb, mb, or gb");
  const amountText = match[1];
  const unit = match[2];
  if (amountText === undefined || unit === undefined) throw new ConfigError("invalid byte size");
  const amount = Number(amountText);
  const multiplier = MULTIPLIERS[unit];
  if (multiplier === undefined || !Number.isSafeInteger(amount)) throw new ConfigError("byte size is unsafe");
  const bytes = amount * multiplier;
  if (!Number.isSafeInteger(bytes)) throw new ConfigError("byte size exceeds the safe integer range");
  if (bytes < minimumBytes) {
    throw new ConfigError(`byte size must be at least ${minimumBytes} byte(s)`);
  }
  return bytes;
}
