import { encoding } from "@warblerjs/crypto";

const LINE_LENGTH = 76;

/** Encodes bytes to MIME base64 with CRLF line wrapping. */
export function encodeBase64Mime(bytes: Uint8Array): string {
  const encoded = encoding.encodeBase64(bytes);
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += LINE_LENGTH) {
    lines.push(encoded.slice(index, index + LINE_LENGTH));
  }
  return lines.join("\r\n");
}

/** Incrementally encodes chunks while carrying 0-2 leftover bytes across boundaries. */
export function createChunkedBase64Encoder(): {
  readonly push: (chunk: Uint8Array) => string;
  readonly finish: () => string;
} {
  let carry = new Uint8Array();
  let column = 0;
  const emitWrapped = (value: string): string => {
    let output = "";
    for (const character of value) {
      if (column === LINE_LENGTH) {
        output += "\r\n";
        column = 0;
      }
      output += character;
      column += 1;
    }
    return output;
  };
  return Object.freeze({
    push(chunk) {
      const combined = new Uint8Array(carry.byteLength + chunk.byteLength);
      combined.set(carry, 0);
      combined.set(chunk, carry.byteLength);
      const usable = combined.byteLength - combined.byteLength % 3;
      carry = combined.slice(usable);
      return usable === 0 ? "" : emitWrapped(encoding.encodeBase64(combined.slice(0, usable)));
    },
    finish() {
      if (carry.byteLength === 0) return "";
      const output = emitWrapped(encoding.encodeBase64(carry));
      carry = new Uint8Array();
      return output;
    },
  });
}
