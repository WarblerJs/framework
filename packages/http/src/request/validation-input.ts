import { ValidatorSourceFlag, type ValidationInput } from "@warbler/validators";
import { cookieMapRecord, requestCookieMap } from "../cookies";
import { parseRequestQuery } from "./request-query";

/** Parses only sources required by one precompiled validator before Runtime execution. */
export async function prepareHttpValidationInput(request: Request, flags: number): Promise<ValidationInput> {
  let value: unknown;
  let query: unknown;
  let path: unknown;
  let headers: unknown;
  let cookies: unknown;
  if ((flags & ValidatorSourceFlag.BODY) !== 0) value = await parseBody(request);
  if ((flags & ValidatorSourceFlag.QUERY) !== 0) query = parseRequestQuery(new URL(request.url), 100);
  if ((flags & ValidatorSourceFlag.PATH) !== 0) path = nativeParams(request);
  if ((flags & ValidatorSourceFlag.HEADERS) !== 0) headers = headersRecord(request.headers);
  if ((flags & ValidatorSourceFlag.COOKIES) !== 0) cookies = cookieMapRecord(requestCookieMap(request));
  return { value, query, path, headers, cookies };
}
async function parseBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json" || mediaType?.endsWith("+json")) return request.json();
  if (mediaType === "multipart/form-data") return formDataRecord(await request.formData());
  if (mediaType === "application/x-www-form-urlencoded") return Object.freeze(Object.fromEntries(new URLSearchParams(await request.text())));
  if (mediaType?.startsWith("text/")) return request.text();
  return undefined;
}
function formDataRecord(form: Awaited<ReturnType<Request["formData"]>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = Object.create(null);
  for (const [name, value] of form.entries()) {
    const current = result[name];
    result[name] = current === undefined
      ? value
      : Array.isArray(current)
        ? Object.freeze([...current, value])
        : Object.freeze([current, value]);
  }
  return Object.freeze(result);
}
function nativeParams(request: Request): Readonly<Record<string, string>> {
  if (!("params" in request) || typeof request.params !== "object" || request.params === null) return Object.freeze(Object.create(null) as Record<string, string>);
  const source = request.params as Readonly<Record<string, string>>;
  const result: Record<string, string> = Object.create(null);
  for (const key in source) result[key] = source[key]!;
  return Object.freeze(result);
}
function headersRecord(headers: Headers): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  for (const [name, value] of headers) result[name.toLowerCase()] = value;
  return Object.freeze(result);
}
