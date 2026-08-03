/** HTTP methods supported by Bun native method route tables. */
export const HttpMethod = Object.freeze({
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
  OPTIONS: "OPTIONS",
  HEAD: "HEAD",
} as const);

/** A supported HTTP method. */
export type HttpMethodValue = (typeof HttpMethod)[keyof typeof HttpMethod];
