import { getCryptoConfig, type PasswordAlgorithm } from "../config";
import { PasswordError } from "../errors";

/** Options for password hashing. */
export interface PasswordHashOptions {
  readonly algorithm?: PasswordAlgorithm;
}

/** Hashes a password using Bun.password and the configured password algorithm. */
export async function hash(value: string, options: PasswordHashOptions = {}): Promise<string> {
  if (typeof value !== "string" || value.length === 0) {
    throw new PasswordError("Password must be a non-empty string.");
  }
  const config = await getCryptoConfig();
  try {
    return await Bun.password.hash(value, {
      algorithm: options.algorithm ?? config.password.algorithm,
    });
  } catch (error) {
    throw new PasswordError("Unable to hash password.", { cause: error });
  }
}

/** Verifies a password hash and returns false for malformed stored hashes. */
export async function verify(value: string, storedHash: string): Promise<boolean> {
  if (typeof value !== "string" || typeof storedHash !== "string" || storedHash.length === 0) return false;
  try {
    return await Bun.password.verify(value, storedHash);
  } catch {
    return false;
  }
}

/** Returns true when a known stored hash uses a different configured algorithm. */
export async function needsRehash(storedHash: string, options: PasswordHashOptions = {}): Promise<boolean> {
  if (typeof storedHash !== "string") return false;
  const config = await getCryptoConfig();
  const algorithm = options.algorithm ?? config.password.algorithm;

  if (storedHash.startsWith("$argon2id$")) return algorithm !== "argon2id";
  if (storedHash.startsWith("$2b$")) return algorithm !== "bcrypt";
  return false;
}

/** Password hashing helpers backed by Bun.password. */
export const password = Object.freeze({
  hash,
  needsRehash,
  verify,
});
