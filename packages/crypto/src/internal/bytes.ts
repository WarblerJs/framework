import { EncodingError } from "../errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Input accepted by Warbler crypto byte-oriented APIs. */
export type ByteInput = string | Uint8Array | ArrayBuffer | ArrayBufferView;

/** Byte array backed by a concrete ArrayBuffer accepted by Web Crypto. */
export type CryptoBytes = Uint8Array<ArrayBuffer>;

function copyToCryptoBytes(value: Uint8Array): CryptoBytes {
  const output = new Uint8Array(new ArrayBuffer(value.byteLength));
  output.set(value);
  return output;
}

/** Converts text into UTF-8 bytes. */
export function utf8ToBytes(value: string): CryptoBytes {
  return copyToCryptoBytes(encoder.encode(value));
}

/** Converts UTF-8 bytes into text and rejects malformed data. */
export function bytesToUtf8(value: Uint8Array): string {
  try {
    return decoder.decode(value);
  } catch (error) {
    throw new EncodingError("UTF-8 payload is malformed.", { cause: error });
  }
}

/** Converts supported input into a defensive byte copy. */
export function toBytes(value: ByteInput): CryptoBytes {
  if (typeof value === "string") return utf8ToBytes(value);
  if (value instanceof Uint8Array) return copyToCryptoBytes(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return copyToCryptoBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new EncodingError("Byte input is invalid.");
}

/** Overwrites a byte buffer in-place. */
export function wipeBytes(value: Uint8Array): void {
  value.fill(0);
}
