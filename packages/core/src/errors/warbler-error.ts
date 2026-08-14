/**
 * Base typed error for application code (controllers/services/repositories) to throw.
 * Transport-agnostic by design — services/repositories must not depend on HTTP/View/
 * WebSocket response types, so this lives in `@warbler/core`, the dependency root every
 * transport package already depends on. Application code throws it (or a convenience
 * subclass) and lets it propagate; the nearest transport boundary catches, normalizes
 * (`normalizeError`), and renders it safely.
 */
export type WarblerErrorSeverity = "info" | "warning" | "error" | "fatal";

/** Additional normalized metadata carried only on the error path. */
export interface WarblerErrorOptions extends ErrorOptions {
  readonly developerMessage?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
  readonly severity?: WarblerErrorSeverity;
}

export class WarblerError extends Error {
  /** Internal diagnostic message for logs/development presenters. Never expose in production. */
  public readonly developerMessage: string | undefined;
  /** Transport-neutral severity used by loggers and presenters. */
  public readonly severity: WarblerErrorSeverity;
  /** Small structured metadata allow-listed by the thrower. */
  public readonly metadata: Readonly<Record<string, unknown>> | undefined;
  /** Optional correlation/request ID attached by a transport boundary. */
  public readonly requestId: string | undefined;

  public constructor(
    /** Stable, machine-readable identifier (e.g. `"USER_NOT_FOUND"`). */
    public readonly code: string,
    /** HTTP-equivalent status used by transports that have one (HTTP JSON, WebSocket envelope metadata). */
    public readonly status: number,
    message?: string,
    /** Whether `message` is safe to send to the client. `false` hides it behind a generic message in production. */
    public readonly expose: boolean = true,
    /** Marks the failure as connection/session-fatal for transports that support that distinction (WebSocket). */
    public readonly fatal: boolean = false,
    options?: WarblerErrorOptions,
  ) {
    super(message ?? code, options);
    this.name = "WarblerError";
    this.developerMessage = options?.developerMessage;
    this.metadata = options?.metadata;
    this.requestId = options?.requestId;
    this.severity = options?.severity ?? (fatal ? "fatal" : status >= 500 ? "error" : status >= 400 ? "warning" : "info");
  }
}

/** 400 — the request itself is malformed or invalid. */
export class BadRequestError extends WarblerError {
  public constructor(code: string, message?: string, options?: ErrorOptions) {
    super(code, 400, message, true, false, options);
    this.name = "BadRequestError";
  }
}

/** 401 — the caller is not authenticated. */
export class UnauthorizedError extends WarblerError {
  public constructor(code: string, message?: string, options?: ErrorOptions) {
    super(code, 401, message, true, false, options);
    this.name = "UnauthorizedError";
  }
}

/** 403 — the caller is authenticated but not permitted. */
export class ForbiddenError extends WarblerError {
  public constructor(code: string, message?: string, options?: ErrorOptions) {
    super(code, 403, message, true, false, options);
    this.name = "ForbiddenError";
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends WarblerError {
  public constructor(code: string, message?: string, options?: ErrorOptions) {
    super(code, 404, message, true, false, options);
    this.name = "NotFoundError";
  }
}

/** 409 — the request conflicts with the current state of the resource. */
export class ConflictError extends WarblerError {
  public constructor(code: string, message?: string, options?: ErrorOptions) {
    super(code, 409, message, true, false, options);
    this.name = "ConflictError";
  }
}
