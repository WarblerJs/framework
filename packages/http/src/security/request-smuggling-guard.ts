import { InvalidRequestError } from "../errors";

/** Rejects ambiguous framing headers before body parsing or CSRF validation. */
export function guardRequestSmuggling(request: Request): void {
  const contentLength = request.headers.get("content-length");
  const transferEncoding = request.headers.get("transfer-encoding");
  if (contentLength !== null && transferEncoding !== null) {
    throw new InvalidRequestError("Conflicting request framing headers");
  }
  if (contentLength === null) return;
  const values = contentLength.split(",");
  let expected: string | undefined;
  for (const raw of values) {
    const value = raw.trim();
    if (!/^(0|[1-9]\d*)$/u.test(value)) throw new InvalidRequestError("Invalid Content-Length");
    if (expected === undefined) expected = value;
    else if (expected !== value) throw new InvalidRequestError("Conflicting Content-Length headers");
  }
}
