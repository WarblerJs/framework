import { random } from "@warblerjs/crypto";
import { normalizeAddressList, normalizeEmailAddress } from "./address";
import { normalizeAttachments } from "./attachment/attachment";
import type { EmailConfig } from "./config";
import type { EmailMessage, NormalizedEmailMessage } from "./email.types";
import { EmailConfigurationError, EmailEncodingError } from "./errors";
import type { EmailTemplateRenderer } from "./template/renderer";

const encoder = new TextEncoder();

function assertSize(value: string, max: number, label: string): void {
  if (encoder.encode(value).byteLength > max) throw new EmailEncodingError(`${label} exceeds configured size limit.`);
}

/** Generates a Message-ID using Warbler crypto randomness. */
export function createMessageId(domain: string): string {
  const safeDomain = domain.replace(/[^A-Za-z0-9.-]/gu, "");
  if (safeDomain.length === 0) throw new EmailConfigurationError("messageIdDomain is invalid.");
  return `${Date.now()}.${random.hex(12)}@${safeDomain}`;
}

/** Normalizes, validates, renders templates, and prepares attachments before transport I/O. */
export async function normalizeEmailMessage(message: EmailMessage, config: EmailConfig, renderer: EmailTemplateRenderer): Promise<NormalizedEmailMessage> {
  const from = normalizeEmailAddress(message.from ?? config.from);
  const to = normalizeAddressList(message.to);
  const cc = normalizeAddressList(message.cc);
  const bcc = normalizeAddressList(message.bcc);
  const replyTo = normalizeAddressList(message.replyTo);
  const recipientCount = to.length + cc.length + bcc.length;
  if (recipientCount === 0) throw new EmailEncodingError("Email requires at least one recipient.");
  if (recipientCount > config.limits.recipients) throw new EmailEncodingError("Email recipient count exceeds configured limit.");
  assertSize(message.subject, config.limits.subjectBytes, "Email subject");
  const headerCount = Object.keys(message.headers ?? {}).length;
  if (headerCount > config.limits.customHeaders) throw new EmailEncodingError("Email custom header count exceeds configured limit.");
  let html = message.html;
  if (message.template !== undefined) {
    try {
      html = await renderer.render(message.template, message.data ?? Object.freeze({}));
    } catch (error) {
      throw error instanceof EmailEncodingError ? error : new EmailEncodingError(`Email template "${message.template}" failed to render.`, { cause: error });
    }
  }
  if (message.template === undefined && (message.text === undefined || message.text.length === 0)) {
    throw new EmailEncodingError("Email requires text when no template is provided.");
  }
  if (message.template !== undefined && (html === undefined || html.length === 0)) {
    throw new EmailEncodingError("Email template must render non-empty content.");
  }
  const attachments = await normalizeAttachments(message.attachments, config.limits);
  return Object.freeze({
    from,
    to,
    cc,
    bcc,
    replyTo,
    subject: message.subject,
    ...(message.text === undefined ? {} : { text: message.text }),
    ...(html === undefined ? {} : { html }),
    ...(message.template === undefined ? {} : { template: message.template }),
    data: Object.freeze({ ...(message.data ?? Object.freeze({})) }),
    attachments,
    headers: Object.freeze({ ...(message.headers ?? Object.freeze({})) }),
  });
}
