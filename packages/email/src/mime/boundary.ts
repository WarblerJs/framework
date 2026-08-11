import { random } from "@warbler/crypto";

/** Generates an unpredictable MIME multipart boundary. */
export function createBoundary(label: string): string {
  return `warbler-${label}-${random.hex(16)}`;
}
