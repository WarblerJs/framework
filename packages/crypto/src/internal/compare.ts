import { toBytes, type ByteInput } from "./bytes";

/** Compares equal-length strings or bytes without data-dependent early exits. */
export function secureCompare(left: ByteInput, right: ByteInput): boolean {
  const leftBytes = toBytes(left);
  const rightBytes = toBytes(right);

  if (leftBytes.byteLength !== rightBytes.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }

  return difference === 0;
}
