import { SmtpProtocolError } from "../../errors";

/** Parsed SMTP response block. */
export interface SmtpResponse {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Incremental SMTP response parser that keeps partial lines buffered. */
export function parseSmtpResponse(buffer: string, lineLimit: number, totalLimit: number): { readonly response?: SmtpResponse; readonly rest: string } {
  if (buffer.length > totalLimit) throw new SmtpProtocolError("SMTP response exceeded configured buffer limit.");
  const parts = buffer.split("\r\n");
  if (!buffer.endsWith("\r\n")) parts.pop();
  if (parts.length === 0) return Object.freeze({ rest: buffer });
  const lines: string[] = [];
  let code: number | undefined;
  let consumed = 0;
  for (const line of parts) {
    consumed += line.length + 2;
    if (line.length > lineLimit) throw new SmtpProtocolError("SMTP response line exceeded configured limit.");
    const match = /^([0-9]{3})([- ])(.*)$/u.exec(line);
    if (match === null) throw new SmtpProtocolError("SMTP response line is malformed.");
    const currentCode = Number(match[1]);
    if (code === undefined) code = currentCode;
    if (currentCode !== code) throw new SmtpProtocolError("SMTP multiline response used inconsistent codes.");
    lines.push(match[3] ?? "");
    if (match[2] === " ") {
      return Object.freeze({ response: Object.freeze({ code, lines: Object.freeze(lines) }), rest: buffer.slice(consumed) });
    }
  }
  return Object.freeze({ rest: buffer });
}

/** Extracts EHLO capabilities by upper-case keyword. */
export function parseSmtpCapabilities(response: SmtpResponse): ReadonlyMap<string, string> {
  const capabilities = new Map<string, string>();
  for (const line of response.lines.slice(1)) {
    const trimmed = line.trim();
    const space = trimmed.indexOf(" ");
    const key = (space === -1 ? trimmed : trimmed.slice(0, space)).toUpperCase();
    if (key.length > 0) capabilities.set(key, space === -1 ? "" : trimmed.slice(space + 1));
  }
  return capabilities;
}
