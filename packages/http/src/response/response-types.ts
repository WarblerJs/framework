/** Options common to native response helpers. */
export interface ResponseOptions {
  readonly status?: number;
  readonly headers?: Bun.HeadersInit;
}

/** Options for file-backed response helpers. */
export interface FileResponseOptions extends ResponseOptions {
  readonly filename?: string;
  readonly cacheControl?: string;
  readonly etag?: string;
  readonly lastModified?: Date;
}

/** One server-sent event. */
export interface ServerSentEvent<TData = unknown> {
  readonly id?: string;
  readonly event?: string;
  readonly data: TData;
  readonly retry?: number;
}
