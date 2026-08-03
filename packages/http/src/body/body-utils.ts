import { BodyLimitError, InvalidRequestError } from "../errors";

export async function readLimitedBlob(request: Request, limit: number): Promise<Blob> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new InvalidRequestError("Invalid Content-Length");
    if (length > limit) throw new BodyLimitError(limit);
  }
  const blob = await request.blob();
  if (blob.size > limit) throw new BodyLimitError(limit);
  return blob;
}
