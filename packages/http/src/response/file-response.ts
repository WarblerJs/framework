import { StaticFileError } from "../errors";
import { safeFilename, safeHeaderValue, toHeaders } from "../internal/header-value";
import type { FileResponseOptions } from "./response-types";

function fileResponse(
  file: Blob,
  contentType: string | undefined,
  disposition: "attachment" | "inline" | undefined,
  options: FileResponseOptions,
): Response {
  if (!(file instanceof Blob)) throw new StaticFileError("Invalid file reference", 500);
  const headers = toHeaders(options.headers);
  if (contentType !== undefined && !headers.has("content-type")) headers.set("content-type", contentType);
  if (disposition !== undefined && !headers.has("content-disposition")) {
    const filename = safeFilename(options.filename ?? "download");
    headers.set("content-disposition", `${disposition}; filename="${filename}"`);
  }
  if (options.cacheControl !== undefined && !headers.has("cache-control")) {
    headers.set("cache-control", safeHeaderValue(options.cacheControl, "cache-control"));
  }
  if (options.etag !== undefined && !headers.has("etag")) headers.set("etag", safeHeaderValue(options.etag, "etag"));
  if (options.lastModified !== undefined && !headers.has("last-modified")) {
    if (!Number.isFinite(options.lastModified.getTime())) throw new StaticFileError("Invalid last-modified date", 500);
    headers.set("last-modified", options.lastModified.toUTCString());
  }
  return new Response(file, { status: options.status, headers });
}

/** Creates a lazily streamed native file response. */
export function FileRes(file: Blob, options: FileResponseOptions = {}): Response {
  return fileResponse(file, undefined, undefined, options);
}

/** Creates a lazily streamed attachment response with a sanitized filename. */
export function DownloadRes(file: Blob, options: FileResponseOptions = {}): Response {
  return fileResponse(file, "application/octet-stream", "attachment", options);
}

/** Creates a lazily streamed inline PDF response. */
export function PdfRes(file: Blob, options: FileResponseOptions = {}): Response {
  return fileResponse(file, "application/pdf", "inline", options);
}

/** Creates a lazily streamed image response using the supplied or native MIME type. */
export function ImageRes(file: Blob, options: FileResponseOptions = {}): Response {
  const contentType = file.type.startsWith("image/") ? file.type : "application/octet-stream";
  return fileResponse(file, contentType, "inline", options);
}

/** Creates a lazily streamed archive attachment response. */
export function ArchiveRes(file: Blob, options: FileResponseOptions = {}): Response {
  return fileResponse(file, "application/zip", "attachment", options);
}
