import type { EmailSendResult, EmailTransport, EncodedEmail } from "../../email.types";
import { SmtpRecipientRejectedError } from "../../errors";
import type { SmtpConfig } from "../../config";
import { SmtpClient } from "./smtp-client";

/** SMTP transport backed by Bun TCP/TLS sockets. */
export class SMTPTransport implements EmailTransport {
  public readonly name = "smtp" as const;

  public constructor(private readonly config: SmtpConfig) {}

  public async send(message: EncodedEmail): Promise<EmailSendResult> {
    const result = await new SmtpClient(this.config).send(message.envelope, message.raw, message.size);
    if (result.accepted.length === 0) throw new SmtpRecipientRejectedError(result.rejected);
    return Object.freeze({
      messageId: message.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
      transport: "smtp",
    });
  }
}
