import { HttpError } from "../errors";

/** Indicates rejected CSRF validation without exposing token details. */
export class CsrfError extends HttpError {
  /** Creates a safe CSRF rejection. */
  public constructor() {
    super("INVALID_REQUEST", "CSRF validation failed.", 403);
    this.name = "CsrfError";
  }
}

/** Creates the production-safe CSRF rejection response. */
export function csrfFailureResponse(): Response {
  return new Response("CSRF validation failed.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
