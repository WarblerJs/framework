import { getCryptoConfig } from "../config";
import { decodeBase64Url, encodeBase64Url } from "../encoding";
import { DecryptionError, EncryptionError, EnvelopeError, KeyError } from "../errors";
import { bytesToUtf8, toBytes, utf8ToBytes, type ByteInput } from "../internal/bytes";

const IV_BYTES = 12;
const ENVELOPE_ALGORITHM = "AES-256-GCM";
const DECRYPTION_ERROR = "Unable to decrypt payload.";

/** Versioned Warbler AES-GCM encrypted payload envelope. */
export interface CryptoEnvelope {
  readonly v: 1;
  readonly alg: "AES-256-GCM";
  readonly kid: string;
  readonly iv: string;
  readonly ct: string;
  readonly ctx?: string;
}

/** Options for encryption operations. */
export interface EncryptOptions {
  readonly keyId?: string;
  readonly context?: ByteInput;
}

/** Options for decryption operations. */
export interface DecryptOptions {
  readonly context?: ByteInput;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function getStringField(envelope: Readonly<Record<string, unknown>>, field: string): string {
  const value = envelope[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new EnvelopeError("Encrypted envelope is malformed.");
  }
  return value;
}

function validateEnvelope(value: unknown): CryptoEnvelope {
  if (!isRecord(value)) throw new EnvelopeError("Encrypted envelope is malformed.");
  if (value.v !== 1 || value.alg !== ENVELOPE_ALGORITHM) {
    throw new EnvelopeError("Encrypted envelope is unsupported.");
  }

  const envelope: CryptoEnvelope = {
    alg: ENVELOPE_ALGORITHM,
    ct: getStringField(value, "ct"),
    iv: getStringField(value, "iv"),
    kid: getStringField(value, "kid"),
    v: 1,
  };

  if (value.ctx !== undefined) {
    if (typeof value.ctx !== "string" || value.ctx.length === 0) {
      throw new EnvelopeError("Encrypted envelope is malformed.");
    }
    return Object.freeze({ ...envelope, ctx: value.ctx });
  }

  return Object.freeze(envelope);
}

function normalizeAdditionalData(context: ByteInput | undefined): Uint8Array | undefined {
  return context === undefined ? undefined : toBytes(context);
}

function assertContextMatch(
  envelopeContext: string | undefined,
  expectedContext: ByteInput | undefined,
): Uint8Array | undefined {
  if (envelopeContext === undefined) return normalizeAdditionalData(expectedContext);

  const decodedEnvelopeContext = decodeBase64Url(envelopeContext);
  if (expectedContext !== undefined) {
    const expected = toBytes(expectedContext);
    if (expected.byteLength !== decodedEnvelopeContext.byteLength) throw new DecryptionError(DECRYPTION_ERROR);
    let difference = 0;
    for (let index = 0; index < expected.byteLength; index += 1) {
      difference |= expected[index]! ^ decodedEnvelopeContext[index]!;
    }
    if (difference !== 0) throw new DecryptionError(DECRYPTION_ERROR);
  }
  return decodedEnvelopeContext;
}

async function getEncryptionKey(keyId: string): Promise<CryptoKey> {
  const config = await getCryptoConfig();
  const key = config.keys.encryption.get(keyId);
  if (key === undefined) throw new KeyError(`Encryption key ${keyId} is not configured.`);
  return key;
}

async function getActiveEncryptionKey(keyId: string | undefined): Promise<readonly [string, CryptoKey]> {
  const config = await getCryptoConfig();
  const selectedKeyId = keyId ?? config.encryption.activeKey;
  if (selectedKeyId === undefined) throw new KeyError("No active encryption key is configured.");

  const key = config.keys.encryption.get(selectedKeyId);
  if (key === undefined) throw new KeyError(`Encryption key ${selectedKeyId} is not configured.`);
  return [selectedKeyId, key] as const;
}

/** Encrypts bytes into a versioned AES-GCM envelope. */
export async function encryptBytes(value: ByteInput, options: EncryptOptions = {}): Promise<CryptoEnvelope> {
  const [keyId, key] = await getActiveEncryptionKey(options.keyId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const additionalData = normalizeAdditionalData(options.context);
  const algorithm = additionalData === undefined ? { name: "AES-GCM", iv } : { name: "AES-GCM", iv, additionalData };

  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(algorithm, key, toBytes(value)));
    const envelope: CryptoEnvelope = {
      alg: ENVELOPE_ALGORITHM,
      ct: encodeBase64Url(ciphertext),
      iv: encodeBase64Url(iv),
      kid: keyId,
      v: 1,
    };
    return Object.freeze(
      additionalData === undefined ? envelope : { ...envelope, ctx: encodeBase64Url(additionalData) },
    );
  } catch (error) {
    throw new EncryptionError("Unable to encrypt payload.", { cause: error });
  }
}

/** Decrypts bytes from a versioned AES-GCM envelope. */
export async function decryptBytes(value: unknown, options: DecryptOptions = {}): Promise<Uint8Array> {
  let envelope: CryptoEnvelope;
  try {
    envelope = validateEnvelope(value);
  } catch (error) {
    throw new DecryptionError(DECRYPTION_ERROR, { cause: error });
  }

  const key = await getEncryptionKey(envelope.kid);

  try {
    const iv = decodeBase64Url(envelope.iv);
    if (iv.byteLength !== IV_BYTES) throw new EnvelopeError("Encrypted envelope IV is malformed.");
    const ciphertext = decodeBase64Url(envelope.ct);
    const additionalData = assertContextMatch(envelope.ctx, options.context);
    const algorithm =
      additionalData === undefined ? { name: "AES-GCM", iv } : { name: "AES-GCM", iv, additionalData };
    return new Uint8Array(await crypto.subtle.decrypt(algorithm, key, ciphertext));
  } catch (error) {
    if (error instanceof KeyError) throw error;
    throw new DecryptionError(DECRYPTION_ERROR, { cause: error });
  }
}

/** Encrypts UTF-8 text into a versioned AES-GCM envelope. */
export function encryptText(value: string, options: EncryptOptions = {}): Promise<CryptoEnvelope> {
  return encryptBytes(utf8ToBytes(value), options);
}

/** Decrypts a versioned AES-GCM envelope into UTF-8 text. */
export async function decryptText(value: unknown, options: DecryptOptions = {}): Promise<string> {
  return bytesToUtf8(await decryptBytes(value, options));
}

/** Encrypts JSON data into a versioned AES-GCM envelope. */
export function encryptJson(value: unknown, options: EncryptOptions = {}): Promise<CryptoEnvelope> {
  return encryptText(JSON.stringify(value), options);
}

/** Decrypts a versioned AES-GCM envelope and parses it as JSON. */
export async function decryptJson<T>(value: unknown, options: DecryptOptions = {}): Promise<T> {
  try {
    return JSON.parse(await decryptText(value, options)) as T;
  } catch (error) {
    if (error instanceof DecryptionError || error instanceof KeyError) throw error;
    throw new DecryptionError(DECRYPTION_ERROR, { cause: error });
  }
}

/** Authenticated encryption helpers for production payload envelopes. */
export const crypt = Object.freeze({
  decryptBytes,
  decryptJson,
  decryptText,
  encryptBytes,
  encryptJson,
  encryptText,
});
