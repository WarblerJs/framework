/** Stable HTTP package error codes. */
export type HttpErrorCode =
  | "BODY_LIMIT"
  | "INVALID_CONFIG"
  | "INVALID_REQUEST"
  | "INVALID_ROUTE"
  | "ROUTE_CONFLICT"
  | "SERVER_STATE"
  | "STATIC_FILE"
  | "UNSUPPORTED_CONTENT_TYPE";

/** Base class for safe typed HTTP failures. */
export class HttpError extends Error {
  /** Creates an HTTP failure with a stable code and safe public message. */
  public constructor(
    public readonly code: HttpErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HttpError";
  }

  /** Returns a response that does not expose internal stack or cause information. */
  public toResponse(): Response {
    return new Response(this.message, {
      status: this.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
