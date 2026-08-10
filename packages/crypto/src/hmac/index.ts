import { getCryptoConfig, type HmacAlgorithm } from "../config";
import { decodeBytes, encodeBytes, type EncodingName } from "../encoding";
import { HmacError, KeyError } from "../errors";
import { toBytes, wipeBytes, type ByteInput } from "../internal/bytes";

/** Explicit HMAC key material for one-off signing or verification. */
export type HmacKeyInput =
  | string
  | CryptoKey
  | {
      readonly material: ByteInput;
      readonly algorithm?: HmacAlgorithm;
    };

/** Options for HMAC signing. */
export interface HmacSignOptions {
  readonly key?: HmacKeyInput;
  readonly output?: EncodingName;
}

/** Options for HMAC verification. */
export interface HmacVerifyOptions {
  readonly key?: HmacKeyInput;
  readonly encoding?: EncodingName;
}

async function importExplicitHmacKey(material: ByteInput, algorithm: HmacAlgorithm): Promise<CryptoKey> {
  const raw = toBytes(material);
  if (raw.byteLength < 16) {
    wipeBytes(raw);
    throw new KeyError("HMAC key material must be at least 16 bytes.");
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: algorithm }, false, ["sign", "verify"]);
  } finally {
    wipeBytes(raw);
  }
}

async function resolveKey(input: HmacKeyInput | undefined): Promise<CryptoKey> {
  const config = await getCryptoConfig();

  if (input instanceof CryptoKey) return input;
  if (typeof input === "object" && input !== null && "material" in input) {
    return importExplicitHmacKey(input.material, input.algorithm ?? config.hmac.algorithm);
  }

  const keyId = input ?? config.hmac.activeKey;
  if (keyId === undefined) throw new KeyError("No active HMAC key is configured.");

  const key = config.keys.hmac.get(keyId);
  if (key === undefined) throw new KeyError(`HMAC key ${keyId} is not configured.`);
  return key;
}

/** Signs bytes or text using Web Crypto HMAC. */
export async function sign(value: ByteInput, options: HmacSignOptions = {}): Promise<string> {
  const config = await getCryptoConfig();
  const key = await resolveKey(options.key);
  try {
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, toBytes(value)));
    return encodeBytes(signature, options.output ?? config.encoding.output);
  } catch (error) {
    throw new HmacError("Unable to sign payload.", { cause: error });
  }
}

/** Verifies an HMAC signature using Web Crypto subtle.verify. */
export async function verify(
  value: ByteInput,
  signature: string | Uint8Array,
  options: HmacVerifyOptions = {},
): Promise<boolean> {
  const config = await getCryptoConfig();
  const key = await resolveKey(options.key);
  const signatureBytes =
    typeof signature === "string" ? decodeBytes(signature, options.encoding ?? config.encoding.output) : toBytes(signature);

  try {
    return await crypto.subtle.verify("HMAC", key, signatureBytes, toBytes(value));
  } catch {
    return false;
  }
}

/** HMAC helpers for keyed message authentication. */
export const hmac = Object.freeze({
  sign,
  verify,
});
