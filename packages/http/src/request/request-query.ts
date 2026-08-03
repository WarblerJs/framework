import { InvalidRequestError } from "../errors";

/** Immutable parsed query values. */
export type RequestQuery = Readonly<Record<string, string | readonly string[]>>;

/** Parses a URL query with a strict parameter-count ceiling. */
export function parseRequestQuery(url: URL, maxParameters: number): RequestQuery {
  const output: Record<string, string | readonly string[]> = Object.create(null);
  let count = 0;
  for (const [key, value] of url.searchParams) {
    count++;
    if (count > maxParameters) throw new InvalidRequestError("Query parameter limit exceeded", 414);
    const current = output[key];
    if (current === undefined) output[key] = value;
    else if (typeof current === "string") output[key] = Object.freeze([current, value]);
    else output[key] = Object.freeze([...current, value]);
  }
  return Object.freeze(output);
}
