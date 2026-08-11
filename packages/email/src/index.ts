export { Email } from "./email";
export { normalizeEmailConfig, type DirectEmailConfigInput, type EmailConfig, type EmailConfigInput, type EmailLimits, type EmailTransportName, type MailConfigFile, type MailSmtpTransportConfig, type SmtpConfig, type SmtpTlsMode } from "./config";
export { LogTransport } from "./transport/log/log-transport";
export { MemoryTransport } from "./transport/memory/memory-transport";
export { SMTPTransport } from "./transport/smtp/smtp-transport";
export { normalizeEmailAddress } from "./address";
export type { EmailAddress, EmailAddressInput, EmailAttachment, EmailMessage, EmailSendResult, EmailTransport, EncodedEmail, NormalizedEmailAttachment, NormalizedEmailMessage } from "./email.types";
export {
  EmailAddressError,
  EmailAttachmentError,
  EmailConfigurationError,
  EmailEncodingError,
  EmailError,
  EmailTemplateError,
  EmailTransportError,
  SmtpAuthenticationError,
  SmtpConnectionError,
  SmtpProtocolError,
  SmtpRecipientRejectedError,
  SmtpTimeoutError,
  SmtpTlsError,
} from "./errors";
