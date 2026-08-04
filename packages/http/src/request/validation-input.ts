import { ValidatorSourceFlag, type ValidationInput } from "@warbler/validators";
import { parseCookies } from "../cookies";
import { parseRequestQuery } from "./request-query";

/** Parses only sources required by one precompiled validator before Runtime execution. */
export async function prepareHttpValidationInput(request: Request, flags: number): Promise<ValidationInput> {
  const result: {
    value?: unknown; query?: unknown; path?: unknown; headers?: unknown; cookies?: unknown;
  } = {};
  if ((flags & ValidatorSourceFlag.BODY) !== 0) result.value = await parseBody(request);
  if ((flags & ValidatorSourceFlag.QUERY) !== 0) result.query = parseRequestQuery(new URL(request.url), 100);
  if ((flags & ValidatorSourceFlag.PATH) !== 0) result.path = nativeParams(request);
  if ((flags & ValidatorSourceFlag.HEADERS) !== 0) result.headers = headersRecord(request.headers);
  if ((flags & ValidatorSourceFlag.COOKIES) !== 0) result.cookies = parseCookies(request.headers.get("cookie"));
  return Object.freeze(result);
}
async function parseBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json" || mediaType?.endsWith("+json")) return request.json();
  if (mediaType === "application/x-www-form-urlencoded") return Object.freeze(Object.fromEntries(new URLSearchParams(await request.text())));
  if (mediaType?.startsWith("text/")) return request.text();
  return undefined;
}
function nativeParams(request: Request): Readonly<Record<string, string>> {
  if (!("params" in request) || typeof request.params !== "object" || request.params === null) return Object.freeze(Object.create(null) as Record<string, string>);
  return Object.freeze({ ...(request.params as Readonly<Record<string, string>>) });
}
function headersRecord(headers: Headers): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  for (const [name, value] of headers) result[name.toLowerCase()] = value;
  return Object.freeze(result);
}
