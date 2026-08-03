import { InvalidRequestError } from "../errors";
import type { UrlEncodedBodyPolicy } from "./body-policy";
import { readLimitedBlob } from "./body-utils";

/** Parses a size-capped URL-encoded body with field count and size enforcement. */
export async function parseUrlEncodedBody(
  request: Request,
  policy: UrlEncodedBodyPolicy,
): Promise<Readonly<Record<string, string | readonly string[]>>> {
  const text = await (await readLimitedBlob(request, policy.maxSize)).text();
  const output: Record<string, string | readonly string[]> = Object.create(null);
  const encoder = new TextEncoder();
  let fields = 0;
  for (const [key, value] of new URLSearchParams(text)) {
    fields++;
    if (fields > policy.maxFields) throw new InvalidRequestError("Form field count limit exceeded");
    if (encoder.encode(key).byteLength > policy.maxFieldSize || encoder.encode(value).byteLength > policy.maxFieldSize) {
      throw new InvalidRequestError("Form field size limit exceeded");
    }
    const current = output[key];
    if (current === undefined) output[key] = value;
    else if (typeof current === "string") output[key] = Object.freeze([current, value]);
    else output[key] = Object.freeze([...current, value]);
  }
  return Object.freeze(output);
}
