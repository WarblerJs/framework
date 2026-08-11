/** Base class for all Warbler email package errors. */
export class EmailError extends Error {
  public constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Raised when mail configuration cannot be normalized safely. */
export class EmailConfigurationError extends EmailError {}
/** Raised when an address is malformed or unsafe for SMTP/MIME usage. */
export class EmailAddressError extends EmailError {}
/** Raised when a template cannot be rendered into message content. */
export class EmailTemplateError extends EmailError {}
/** Raised when MIME or transfer encoding fails. */
export class EmailEncodingError extends EmailError {}
/** Raised when an attachment is missing, unsafe, or exceeds configured limits. */
export class EmailAttachmentError extends EmailError {}
/** Raised when a transport fails before a more specific SMTP category applies. */
export class EmailTransportError extends EmailError {}
/** Raised when the SMTP socket cannot be opened or is reset. */
export class SmtpConnectionError extends EmailTransportError {
  /** Stable network failure class suitable for application branching. */
  public readonly code: "dns" | "refused" | "reset" | "socket";

  public constructor(message: string, code: SmtpConnectionError["code"], options: ErrorOptions = {}) {
    super(message, options);
    this.code = code;
  }
}
/** Raised when an SMTP peer sends malformed or unexpected protocol data. */
export class SmtpProtocolError extends EmailTransportError {}
/** Raised when SMTP authentication fails or is unavailable. */
export class SmtpAuthenticationError extends EmailTransportError {}
/** Raised when implicit TLS or STARTTLS cannot be established safely. */
export class SmtpTlsError extends EmailTransportError {}
/** Raised when an SMTP phase exceeds its configured deadline. */
export class SmtpTimeoutError extends EmailTransportError {}
/** Raised when every SMTP recipient is rejected. */
export class SmtpRecipientRejectedError extends EmailTransportError {
  /** Recipients rejected by the server. */
  public readonly rejected: readonly string[];

  public constructor(rejected: readonly string[]) {
    super("SMTP server rejected every recipient.");
    this.rejected = Object.freeze([...rejected]);
  }
}
