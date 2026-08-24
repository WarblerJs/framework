import { ConfigError } from "@warblerjs/config";
import { parseEnv } from "@warblerjs/config/parser";
import { decodeBase64, decodeBase64Url, decodeHex, type EncodingName } from "../encoding";
import { CryptoConfigError } from "../errors";
import { wipeBytes, type CryptoBytes } from "../internal/bytes";
import type {
  CompiledCryptoConfig,
  CryptoConfigInput,
  EncryptionAlgorithm,
  HashAlgorithm,
  HmacAlgorithm,
  KeyMaterialReference,
  PasswordAlgorithm,
} from "./types";

const AES_KEY_BYTES = 32;
const HMAC_MINIMUM_KEY_BYTES = 16;
const DEFAULT_RANDOM_MAX_BYTES = 1024 * 1024;
const DEFAULT_KEY_CACHE_SIZE = 64;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

let configuredCrypto: Promise<CompiledCryptoConfig> | undefined;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function assertEncoding(value: unknown, path: string): EncodingName {
  if (value === "hex" || value === "base64" || value === "base64url") return value;
  throw new CryptoConfigError(`${path} must be hex, base64, or base64url.`);
}

function assertPasswordAlgorithm(value: unknown): PasswordAlgorithm {
  if (value === "argon2id" || value === "bcrypt") return value;
  throw new CryptoConfigError("password.algorithm must be argon2id or bcrypt.");
}

function assertHashAlgorithm(value: unknown): HashAlgorithm {
  if (value === "sha256" || value === "sha512") return value;
  throw new CryptoConfigError("hashing.algorithm must be sha256 or sha512.");
}

function assertEncryptionAlgorithm(value: unknown): EncryptionAlgorithm {
  if (value === "AES-256-GCM") return value;
  throw new CryptoConfigError("encryption.algorithm must be AES-256-GCM.");
}

function assertHmacAlgorithm(value: unknown): HmacAlgorithm {
  if (value === "SHA-256" || value === "SHA-512") return value;
  throw new CryptoConfigError("hmac.algorithm must be SHA-256 or SHA-512.");
}

function assertPositiveInteger(value: unknown, path: string): number {
  if (Number.isSafeInteger(value) && typeof value === "number" && value > 0) return value;
  throw new CryptoConfigError(`${path} must be a positive safe integer.`);
}

function assertKeyId(value: unknown, path: string): string {
  if (typeof value === "string" && KEY_ID_PATTERN.test(value)) return value;
  throw new CryptoConfigError(`${path} must be a safe key id.`);
}

function getDefaultConfig(): CryptoConfigInput {
  return Object.freeze({
    encoding: Object.freeze({ output: "base64url" }),
    encryption: Object.freeze({ algorithm: "AES-256-GCM", envelopeVersion: 1 }),
    hashing: Object.freeze({ algorithm: "sha256", output: "hex" }),
    hmac: Object.freeze({ algorithm: "SHA-256" }),
    password: Object.freeze({ algorithm: "argon2id" }),
    random: Object.freeze({ maxBytes: DEFAULT_RANDOM_MAX_BYTES, tokenBytes: 32 }),
  });
}

function decodeSecretMaterial(material: string, path: string): CryptoBytes {
  const trimmed = material.trim();
  try {
    if (trimmed.startsWith("base64url:")) return decodeBase64Url(trimmed.slice("base64url:".length));
    if (trimmed.startsWith("base64:")) return decodeBase64(trimmed.slice("base64:".length));
    if (trimmed.startsWith("hex:")) return decodeHex(trimmed.slice("hex:".length));
    if (/^[A-Za-z0-9_-]+={0,2}$/u.test(trimmed)) return decodeBase64Url(trimmed);
    if (/^(?:[0-9a-fA-F]{2})+$/u.test(trimmed)) return decodeHex(trimmed);
  } catch (error) {
    throw new CryptoConfigError(`${path} contains malformed key material.`, { cause: error });
  }
  throw new CryptoConfigError(`${path} must be base64url, base64, or hex key material.`);
}

function resolveMaterial(reference: KeyMaterialReference, path: string): CryptoBytes {
  if (typeof reference === "string") return decodeSecretMaterial(reference, path);

  if ("env" in reference) {
    try {
      return decodeSecretMaterial(parseEnv(reference.env), `${path}.env(${reference.env})`);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new CryptoConfigError(`${path} references missing or invalid environment variable ${reference.env}.`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  return decodeSecretMaterial(reference.material, `${path}.material`);
}

async function importAesKey(raw: CryptoBytes, path: string): Promise<CryptoKey> {
  if (raw.byteLength !== AES_KEY_BYTES) {
    throw new CryptoConfigError(`${path} must decode to exactly ${AES_KEY_BYTES} bytes.`);
  }
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    wipeBytes(raw);
  }
}

async function importHmacKey(raw: CryptoBytes, algorithm: HmacAlgorithm, path: string): Promise<CryptoKey> {
  if (raw.byteLength < HMAC_MINIMUM_KEY_BYTES) {
    throw new CryptoConfigError(`${path} must decode to at least ${HMAC_MINIMUM_KEY_BYTES} bytes.`);
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: algorithm }, false, ["sign", "verify"]);
  } finally {
    wipeBytes(raw);
  }
}

function boundedEntries(
  keyInput: Readonly<Record<string, KeyMaterialReference>> | undefined,
  cacheSize: number,
  path: string,
): ReadonlyArray<readonly [string, KeyMaterialReference]> {
  const entries = Object.entries(keyInput ?? {});
  if (entries.length > cacheSize) {
    throw new CryptoConfigError(`${path} contains more keys than its configured cache size.`);
  }
  for (const [id] of entries) assertKeyId(id, `${path}.${id}`);
  return entries;
}

async function compileConfig(input: CryptoConfigInput): Promise<CompiledCryptoConfig> {
  const defaults = getDefaultConfig();
  const passwordAlgorithm = assertPasswordAlgorithm(input.password?.algorithm ?? defaults.password?.algorithm);
  const hashAlgorithm = assertHashAlgorithm(input.hashing?.algorithm ?? defaults.hashing?.algorithm);
  const hashOutput = assertEncoding(input.hashing?.output ?? defaults.hashing?.output, "hashing.output");
  const defaultOutput = assertEncoding(input.encoding?.output ?? defaults.encoding?.output, "encoding.output");
  const encryptionAlgorithm = assertEncryptionAlgorithm(input.encryption?.algorithm ?? defaults.encryption?.algorithm);
  const envelopeVersion = input.encryption?.envelopeVersion ?? 1;
  if (envelopeVersion !== 1) throw new CryptoConfigError("encryption.envelopeVersion must be 1.");
  const encryptionCacheSize = assertPositiveInteger(
    input.encryption?.cacheSize ?? DEFAULT_KEY_CACHE_SIZE,
    "encryption.cacheSize",
  );
  const hmacAlgorithm = assertHmacAlgorithm(input.hmac?.algorithm ?? defaults.hmac?.algorithm);
  const hmacCacheSize = assertPositiveInteger(input.hmac?.cacheSize ?? DEFAULT_KEY_CACHE_SIZE, "hmac.cacheSize");
  const maxBytes = assertPositiveInteger(input.random?.maxBytes ?? DEFAULT_RANDOM_MAX_BYTES, "random.maxBytes");
  const tokenBytes = assertPositiveInteger(input.random?.tokenBytes ?? 32, "random.tokenBytes");
  if (maxBytes > DEFAULT_RANDOM_MAX_BYTES) {
    throw new CryptoConfigError("random.maxBytes cannot exceed 1048576 bytes.");
  }
  if (tokenBytes > maxBytes) {
    throw new CryptoConfigError("random.tokenBytes cannot exceed random.maxBytes.");
  }

  const encryptionActiveKey =
    input.encryption?.activeKey === undefined
      ? undefined
      : assertKeyId(input.encryption.activeKey, "encryption.activeKey");
  const hmacActiveKey =
    input.hmac?.activeKey === undefined ? undefined : assertKeyId(input.hmac.activeKey, "hmac.activeKey");

  const encryptionKeys = new Map<string, CryptoKey>();
  await Promise.all(
    boundedEntries(input.encryption?.keys, encryptionCacheSize, "encryption.keys").map(async ([id, reference]) => {
      encryptionKeys.set(
        id,
        await importAesKey(resolveMaterial(reference, `encryption.keys.${id}`), `encryption.keys.${id}`),
      );
    }),
  );

  const hmacKeys = new Map<string, CryptoKey>();
  await Promise.all(
    boundedEntries(input.hmac?.keys, hmacCacheSize, "hmac.keys").map(async ([id, reference]) => {
      hmacKeys.set(
        id,
        await importHmacKey(resolveMaterial(reference, `hmac.keys.${id}`), hmacAlgorithm, `hmac.keys.${id}`),
      );
    }),
  );

  if (encryptionActiveKey !== undefined && !encryptionKeys.has(encryptionActiveKey)) {
    throw new CryptoConfigError(`encryption.activeKey ${encryptionActiveKey} is not configured.`);
  }
  if (hmacActiveKey !== undefined && !hmacKeys.has(hmacActiveKey)) {
    throw new CryptoConfigError(`hmac.activeKey ${hmacActiveKey} is not configured.`);
  }

  return Object.freeze({
    encoding: Object.freeze({ output: defaultOutput }),
    encryption: Object.freeze({
      activeKey: encryptionActiveKey,
      algorithm: encryptionAlgorithm,
      cacheSize: encryptionCacheSize,
      envelopeVersion,
    }),
    hashing: Object.freeze({ algorithm: hashAlgorithm, output: hashOutput }),
    hmac: Object.freeze({ activeKey: hmacActiveKey, algorithm: hmacAlgorithm, cacheSize: hmacCacheSize }),
    keys: Object.freeze({
      activeKey: encryptionActiveKey,
      encryption: encryptionKeys,
      hmac: hmacKeys,
    }),
    password: Object.freeze({ algorithm: passwordAlgorithm }),
    random: Object.freeze({ maxBytes, tokenBytes }),
  });
}

/** Configures and validates Warbler crypto for production startup. */
export function configureCrypto(input: CryptoConfigInput = getDefaultConfig()): Promise<CompiledCryptoConfig> {
  if (!isRecord(input)) throw new CryptoConfigError("crypto configuration must be an object.");
  configuredCrypto = compileConfig(input);
  return configuredCrypto;
}

/** Returns the active compiled crypto configuration, lazily compiling defaults when needed. */
export function getCryptoConfig(): Promise<CompiledCryptoConfig> {
  configuredCrypto ??= compileConfig(getDefaultConfig());
  return configuredCrypto;
}

/** Clears memoized crypto configuration for isolated test processes. */
export function resetCryptoForTests(): void {
  configuredCrypto = undefined;
}
