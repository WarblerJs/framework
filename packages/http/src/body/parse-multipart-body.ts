import { InvalidRequestError } from "../errors";
import type { MultipartBodyPolicy } from "./body-policy";
import { readLimitedBlob } from "./body-utils";

/** Native multipart form data returned by Request.formData(). */
export type MultipartFormData = Awaited<ReturnType<Request["formData"]>>;

/** Parses a bounded multipart body using the native FormData implementation. */
export async function parseMultipartBody(
  request: Request,
  policy: MultipartBodyPolicy,
): Promise<MultipartFormData> {
  const blob = await readLimitedBlob(request, policy.maxSize);
  const bounded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: blob,
  });
  let form: MultipartFormData;
  try {
    form = await bounded.formData();
  } catch (error) {
    throw new InvalidRequestError("Malformed multipart body", 400, { cause: error });
  }
  let files = 0;
  let fields = 0;
  const encoder = new TextEncoder();
  for (const [name, value] of form) {
    if (encoder.encode(name).byteLength > policy.maxFieldSize) {
      throw new InvalidRequestError("Multipart field name limit exceeded");
    }
    if (typeof value === "string") {
      fields++;
      if (fields > policy.maxFields || encoder.encode(value).byteLength > policy.maxFieldSize) {
        throw new InvalidRequestError("Multipart field limit exceeded");
      }
    } else {
      files++;
      if (files > policy.maxFiles || value.size > policy.maxFileSize) {
        throw new InvalidRequestError("Multipart file limit exceeded");
      }
      if (policy.allowedMimeTypes.length > 0 && !policy.allowedMimeTypes.includes(value.type)) {
        throw new InvalidRequestError("Multipart MIME type is not allowed");
      }
    }
  }
  return form;
}
