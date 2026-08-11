const encoder = new TextEncoder();

/** Encodes text as quoted-printable with CRLF line endings. */
export function encodeQuotedPrintable(value: string): string {
  const normalized = value.replace(/\r?\n/gu, "\r\n");
  const output: string[] = [];
  let lineLength = 0;
  const append = (piece: string): void => {
    if (lineLength + piece.length > 75) {
      output.push("=\r\n");
      lineLength = 0;
    }
    output.push(piece);
    lineLength += piece.length;
  };
  for (const byte of encoder.encode(normalized)) {
    if (byte === 13) {
      output.push("\r");
      lineLength = 0;
      continue;
    }
    if (byte === 10) {
      output.push("\n");
      continue;
    }
    const safe = byte >= 33 && byte <= 60 || byte >= 62 && byte <= 126;
    append(safe ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  return output.join("");
}
