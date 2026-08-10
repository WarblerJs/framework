import { decodeBase64, decodeBase64Url, decodeHex, encodeBase64Url } from "../encoding";
import { KeyError } from "../errors";
import { toBytes, wipeBytes, type ByteInput, type CryptoBytes } from "../internal/bytes";
import { bytes as randomBytes } from "../random";
import type { HmacAlgorithm } from "../config";

/** Purpose for an imported or generated cryptographic key. */
export type KeyPurpose = "encryption" | "hmac";

/** Options for generating key material. */
export interface GenerateKeyOptions {
  readonly for: KeyPurpose;
  readonly bytes?: number;
}

/** Options for importing key material into Web Crypto. */
export interface ImportKeyOptions {
  readonly for: KeyPurpose;
  readonly algorithm?: HmacAlgorithm;
  readonly extractable?: boolean;
}

/** Options for exporting extractable key material. */
export interface ExportKeyOptions {
  readonly output?: "base64url";
}

/** Generates raw key material encoded as base64url text. */
export function generate(options: GenerateKeyOptions): string {
  const length = options.bytes ?? (options.for === "encryption" ? 32 : 32);
  if (options.for !== "encryption" && options.for !== "hmac") {
    throw new KeyError("Key purpose is unsupported.");
  }
  return encodeBase64Url(randomBytes(length));
}

function decodeKeyMaterial(material: ByteInput): CryptoBytes {
  if (typeof material !== "string") return toBytes(material);

  const trimmed = material.trim();
  try {
    if (trimmed.startsWith("base64url:")) return decodeBase64Url(trimmed.slice("base64url:".length));
    if (trimmed.startsWith("base64:")) return decodeBase64(trimmed.slice("base64:".length));
    if (trimmed.startsWith("hex:")) return decodeHex(trimmed.slice("hex:".length));
    if (/^[A-Za-z0-9_-]+={0,2}$/u.test(trimmed)) return decodeBase64Url(trimmed);
    if (/^(?:[0-9a-fA-F]{2})+$/u.test(trimmed)) return decodeHex(trimmed);
  } catch (error) {
    throw new KeyError("Key material is malformed.", { cause: error });
  }

  return toBytes(material);
}

/** Imports raw key material into a non-extractable CryptoKey by default. */
export async function importKeyMaterial(material: ByteInput, options: ImportKeyOptions): Promise<CryptoKey> {
  const raw = decodeKeyMaterial(material);
  const extractable = options.extractable ?? false;
  try {
    if (options.for === "encryption") {
      if (raw.byteLength !== 32) throw new KeyError("Encryption key material must be exactly 32 bytes.");
      return await crypto.subtle.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"]);
    }

    if (options.for === "hmac") {
      if (raw.byteLength < 16) throw new KeyError("HMAC key material must be at least 16 bytes.");
      return await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "HMAC", hash: options.algorithm ?? "SHA-256" },
        extractable,
        ["sign", "verify"],
      );
    }
  } finally {
    wipeBytes(raw);
  }

  throw new KeyError("Key purpose is unsupported.");
}

/** Exports an extractable raw CryptoKey as base64url text. */
export async function exportKeyMaterial(key: CryptoKey, options: ExportKeyOptions = {}): Promise<string> {
  if (options.output !== undefined && options.output !== "base64url") {
    throw new KeyError("Only base64url key export is supported.");
  }
  try {
    return encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
  } catch (error) {
    throw new KeyError("Key is not extractable.", { cause: error });
  }
}

/** Key generation and Web Crypto import/export helpers. */
export const keys = Object.freeze({
  export: exportKeyMaterial,
  generate,
  import: importKeyMaterial,
});
