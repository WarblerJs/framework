import { EncodingError } from "../errors";
import { bytesToUtf8, utf8ToBytes, type CryptoBytes } from "../internal/bytes";

const BASE64_CHUNK_SIZE = 0x8000;
const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})*$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/u;

/** Supported textual encodings for digests, keys, tokens, signatures, and envelopes. */
export type EncodingName = "hex" | "base64" | "base64url";

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

function binaryToBytes(binary: string): CryptoBytes {
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function padBase64(value: string): string {
  const remainder = value.length % 4;
  if (remainder === 0) return value;
  if (remainder === 2) return `${value}==`;
  if (remainder === 3) return `${value}=`;
  throw new EncodingError("Base64url payload is malformed.");
}

/** Encodes bytes as lowercase hexadecimal text. */
export function encodeHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

/** Decodes strict hexadecimal text into bytes. */
export function decodeHex(value: string): CryptoBytes {
  if (!HEX_PATTERN.test(value)) throw new EncodingError("Hex payload is malformed.");

  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Encodes bytes as standard padded base64 text. */
export function encodeBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

/** Decodes strict standard base64 text into bytes. */
export function decodeBase64(value: string): CryptoBytes {
  if (!BASE64_PATTERN.test(value)) throw new EncodingError("Base64 payload is malformed.");
  try {
    return binaryToBytes(atob(value));
  } catch (error) {
    throw new EncodingError("Base64 payload is malformed.", { cause: error });
  }
}

/** Encodes bytes as unpadded base64url text. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Decodes strict base64url text into bytes. */
export function decodeBase64Url(value: string): CryptoBytes {
  if (!BASE64URL_PATTERN.test(value) || value.includes("=") && !/=+$/u.test(value)) {
    throw new EncodingError("Base64url payload is malformed.");
  }

  const unpadded = value.replace(/=+$/u, "");
  const normalized = padBase64(unpadded).replaceAll("-", "+").replaceAll("_", "/");
  return decodeBase64(normalized);
}

/** Encodes bytes using a supported textual encoding. */
export function encodeBytes(bytes: Uint8Array, format: EncodingName): string {
  if (format === "hex") return encodeHex(bytes);
  if (format === "base64") return encodeBase64(bytes);
  if (format === "base64url") return encodeBase64Url(bytes);
  throw new EncodingError("Encoding format is unsupported.");
}

/** Decodes text using a supported textual encoding. */
export function decodeBytes(value: string, format: EncodingName): CryptoBytes {
  if (format === "hex") return decodeHex(value);
  if (format === "base64") return decodeBase64(value);
  if (format === "base64url") return decodeBase64Url(value);
  throw new EncodingError("Encoding format is unsupported.");
}

/** Encoding helpers for strict hex, base64, base64url, and UTF-8 conversions. */
export const encoding = Object.freeze({
  bytesToUtf8,
  decode: decodeBytes,
  decodeBase64,
  decodeBase64Url,
  decodeHex,
  encode: encodeBytes,
  encodeBase64,
  encodeBase64Url,
  encodeHex,
  utf8ToBytes,
});
