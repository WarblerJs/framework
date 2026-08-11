import type { EmailSendResult, EmailTransport, EncodedEmail } from "../../email.types";

/** Deterministic in-memory transport for tests and local assertions. */
export class MemoryTransport implements EmailTransport {
  private readonly messagesInternal: EncodedEmail[] = [];
  public readonly name = "memory" as const;

  /** Immutable snapshot of sent messages. */
  public get messages(): readonly EncodedEmail[] {
    return Object.freeze([...this.messagesInternal]);
  }

  /** Clears captured messages without replacing the transport instance. */
  public reset(): void {
    this.messagesInternal.length = 0;
  }

  public async send(message: EncodedEmail): Promise<EmailSendResult> {
    this.messagesInternal.push(message);
    return Object.freeze({
      messageId: message.messageId,
      accepted: Object.freeze(message.envelope.recipients.map((item) => item.email)),
      rejected: Object.freeze([]),
      transport: "memory",
    });
  }
}
