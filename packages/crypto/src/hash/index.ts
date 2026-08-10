import { getCryptoConfig, type HashAlgorithm } from "../config";
import { encodeBytes, type EncodingName } from "../encoding";
import { HashingError } from "../errors";
import { toBytes, type ByteInput } from "../internal/bytes";

/** Options for digest operations. */
export interface DigestOptions {
  readonly algorithm?: HashAlgorithm;
  readonly output?: EncodingName;
}

/** Inputs accepted by file digest operations. */
export type HashFileInput = string | URL | Blob;

function createHasher(algorithm: HashAlgorithm): Bun.CryptoHasher {
  try {
    return new Bun.CryptoHasher(algorithm);
  } catch (error) {
    throw new HashingError("Hash algorithm is unsupported.", { cause: error });
  }
}

function outputDigest(hasher: Bun.CryptoHasher, output: EncodingName): string {
  const digestBytes = new Uint8Array(hasher.digest());
  return encodeBytes(digestBytes, output);
}

/** Hashes bytes or text using the configured digest algorithm. */
export async function digest(value: ByteInput, options: DigestOptions = {}): Promise<string> {
  const config = await getCryptoConfig();
  const hasher = createHasher(options.algorithm ?? config.hashing.algorithm);
  hasher.update(toBytes(value));
  return outputDigest(hasher, options.output ?? config.hashing.output);
}

/** Hashes bytes or text with SHA-256. */
export function sha256(value: ByteInput, output: EncodingName = "hex"): string {
  const hasher = createHasher("sha256");
  hasher.update(toBytes(value));
  return outputDigest(hasher, output);
}

/** Hashes bytes or text with SHA-512. */
export function sha512(value: ByteInput, output: EncodingName = "hex"): string {
  const hasher = createHasher("sha512");
  hasher.update(toBytes(value));
  return outputDigest(hasher, output);
}

/** Hashes a file stream without loading the entire file into memory. */
export async function file(input: HashFileInput, options: DigestOptions = {}): Promise<string> {
  const config = await getCryptoConfig();
  const source = input instanceof Blob ? input : Bun.file(input);
  const hasher = createHasher(options.algorithm ?? config.hashing.algorithm);
  const reader = source.stream().getReader();

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      hasher.update(result.value);
    }
  } catch (error) {
    throw new HashingError("Unable to hash file.", { cause: error });
  } finally {
    reader.releaseLock();
  }

  return outputDigest(hasher, options.output ?? config.hashing.output);
}

/** Non-secret digest helpers backed by Bun.CryptoHasher. */
export const hash = Object.freeze({
  digest,
  file,
  sha256,
  sha512,
});
