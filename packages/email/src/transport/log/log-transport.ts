import type { EmailSendResult, EmailTransport, EncodedEmail } from "../../email.types";

/** Safe development transport that logs metadata without message bodies or secrets by default. */
export class LogTransport implements EmailTransport {
  public readonly name = "log" as const;
  public constructor(private readonly includeBodies = false) {}

  public async send(message: EncodedEmail): Promise<EmailSendResult> {
    const metadata = Object.freeze({
      messageId: message.messageId,
      to: message.message.to.map((item) => item.email),
      cc: message.message.cc.map((item) => item.email),
      subject: message.message.subject,
      template: message.message.template,
      attachments: message.message.attachments.map((item) => item.filename),
      ...(this.includeBodies ? { text: message.message.text, html: message.message.html?.slice(0, 2048) } : {}),
    });
    console.info("[warbler:email]", metadata);
    return Object.freeze({
      messageId: message.messageId,
      accepted: Object.freeze(message.envelope.recipients.map((item) => item.email)),
      rejected: Object.freeze([]),
      transport: "log",
    });
  }
}
