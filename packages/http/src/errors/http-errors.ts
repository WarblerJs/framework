import { HttpError } from "./http-error";

/** Indicates conflicting method/path route definitions. */
export class RouteConflictError extends HttpError {
  /** Creates a route conflict failure. */
  public constructor(method: string, path: string) {
    super("ROUTE_CONFLICT", `Duplicate route: ${method} ${path}`, 500, { method, path });
    this.name = "RouteConflictError";
  }
}

/** Indicates malformed route metadata or compiled route data. */
export class InvalidRouteError extends HttpError {
  /** Creates an invalid route failure. */
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVALID_ROUTE", message, 500, details);
    this.name = "InvalidRouteError";
  }
}

/** Indicates an unsafe or malformed incoming request. */
export class InvalidRequestError extends HttpError {
  /** Creates an invalid request failure. */
  public constructor(message: string, status = 400, options?: ErrorOptions) {
    super("INVALID_REQUEST", message, status, undefined, options);
    this.name = "InvalidRequestError";
  }
}

/** Indicates that a request body exceeded its configured ceiling. */
export class BodyLimitError extends HttpError {
  /** Creates a body-limit failure. */
  public constructor(limit: number) {
    super("BODY_LIMIT", `Request body exceeds ${limit} bytes`, 413, { limit });
    this.name = "BodyLimitError";
  }
}

/** Indicates a request body media type that policy does not accept. */
export class UnsupportedContentTypeError extends HttpError {
  /** Creates an unsupported-content-type failure. */
  public constructor(contentType: string) {
    super("UNSUPPORTED_CONTENT_TYPE", `Unsupported content type: ${contentType}`, 415);
    this.name = "UnsupportedContentTypeError";
  }
}

/** Indicates an invalid native HTTP server lifecycle transition. */
export class ServerStateError extends HttpError {
  /** Creates a server-state failure. */
  public constructor(message: string, options?: ErrorOptions) {
    super("SERVER_STATE", message, 500, undefined, options);
    this.name = "ServerStateError";
  }
}

/** Indicates invalid HTTP configuration. */
export class InvalidHttpConfigError extends HttpError {
  /** Creates an invalid configuration failure. */
  public constructor(path: string, message: string) {
    super("INVALID_CONFIG", `${path}: ${message}`, 500, { path });
    this.name = "InvalidHttpConfigError";
  }
}

/** Indicates an unsafe or unavailable static file. */
export class StaticFileError extends HttpError {
  /** Creates a static-file failure. */
  public constructor(message: string, status = 404, options?: ErrorOptions) {
    super("STATIC_FILE", message, status, undefined, options);
    this.name = "StaticFileError";
  }
}
