/** Address accepted by the email API. */
export type EmailAddressInput = string | EmailAddress;

/** Normalized mailbox address. */
export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

/** Attachment content accepted by the email API. */
export type EmailAttachmentContent = string | Uint8Array | ArrayBuffer | Blob;

/** File or in-memory attachment accepted by the email API. */
export interface EmailAttachment {
  readonly filename?: string;
  readonly path?: string;
  readonly content?: EmailAttachmentContent;
  readonly contentType?: string;
  readonly contentId?: string;
  readonly disposition?: "attachment" | "inline";
}

/** Fields shared by every high-level message input passed to Email.send(). */
export interface EmailMessageBase {
  readonly from?: EmailAddressInput;
  readonly to?: EmailAddressInput | readonly EmailAddressInput[];
  readonly cc?: EmailAddressInput | readonly EmailAddressInput[];
  readonly bcc?: EmailAddressInput | readonly EmailAddressInput[];
  readonly replyTo?: EmailAddressInput | readonly EmailAddressInput[];
  readonly subject: string;
  readonly html?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly attachments?: readonly EmailAttachment[];
  readonly headers?: Readonly<Record<string, string>>;
}

/** Message rendered from a compiled template; `text` is optional. */
export interface TemplateEmailMessage extends EmailMessageBase {
  readonly template: string;
  readonly text?: string;
}

/** Message without a template; `text` is mandatory. */
export interface TextEmailMessage extends EmailMessageBase {
  readonly text: string;
  readonly template?: undefined;
}

/** High-level message input passed to Email.send(). */
export type EmailMessage = TemplateEmailMessage | TextEmailMessage;

/** SMTP envelope plus immutable MIME payload prepared for transport. */
export interface EncodedEmail {
  readonly messageId: string;
  readonly envelope: EmailEnvelope;
  readonly message: NormalizedEmailMessage;
  readonly raw: string;
  readonly size: number;
}

/** SMTP envelope recipients. */
export interface EmailEnvelope {
  readonly from: EmailAddress;
  readonly recipients: readonly EmailAddress[];
}

/** Normalized attachment bytes and metadata. */
export interface NormalizedEmailAttachment {
  readonly filename: string;
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly contentId?: string;
  readonly disposition: "attachment" | "inline";
}

/** Fully normalized message used by MIME encoders and test transports. */
export interface NormalizedEmailMessage {
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc: readonly EmailAddress[];
  readonly bcc: readonly EmailAddress[];
  readonly replyTo: readonly EmailAddress[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly template?: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly attachments: readonly NormalizedEmailAttachment[];
  readonly headers: Readonly<Record<string, string>>;
}

/** Transport result returned by Email.send(). */
export interface EmailSendResult {
  readonly messageId: string;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  readonly transport: "smtp" | "log" | "memory";
}

/** Transport contract implemented by SMTP, log, memory, and future transports. */
export interface EmailTransport {
  readonly name: EmailSendResult["transport"];
  send(message: EncodedEmail): Promise<EmailSendResult>;
}
