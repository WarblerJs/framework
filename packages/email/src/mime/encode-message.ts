import { formatAddress } from "../address";
import type { EncodedEmail, NormalizedEmailAttachment, NormalizedEmailMessage } from "../email.types";
import { createBoundary } from "./boundary";
import { encodeBase64Mime } from "./base64";
import { encodeHeaderValue, foldHeader, validateHeaderName, validateHeaderValue } from "./encode-header";
import { encodeQuotedPrintable } from "./quoted-printable";

function textPart(kind: "plain" | "html", content: string): string {
  return [
    `Content-Type: text/${kind}; charset=utf-8`,
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(content),
  ].join("\r\n");
}

function attachmentPart(attachment: NormalizedEmailAttachment): string {
  const headers = [
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${attachment.disposition}; filename="${attachment.filename}"`,
    ...(attachment.contentId === undefined ? [] : [`Content-ID: <${attachment.contentId}>`]),
  ];
  return [...headers, "", encodeBase64Mime(attachment.content)].join("\r\n");
}

function multipart(boundary: string, contentType: string, parts: readonly string[]): string {
  return [
    `Content-Type: ${contentType}; boundary="${boundary}"`,
    "",
    ...parts.flatMap((part) => [`--${boundary}`, part]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function bodyFor(message: NormalizedEmailMessage): string {
  const text = message.text === undefined ? undefined : textPart("plain", message.text);
  const html = message.html === undefined ? undefined : textPart("html", message.html);
  const base = text !== undefined && html !== undefined
    ? multipart(createBoundary("alternative"), "multipart/alternative", [text, html])
    : html ?? text ?? "";
  const inline = message.attachments.filter((item) => item.disposition === "inline");
  const related = inline.length === 0 ? base : multipart(createBoundary("related"), "multipart/related", [base, ...inline.map(attachmentPart)]);
  const regular = message.attachments.filter((item) => item.disposition === "attachment");
  return regular.length === 0 ? related : multipart(createBoundary("mixed"), "multipart/mixed", [related, ...regular.map(attachmentPart)]);
}

function headersFor(message: NormalizedEmailMessage, messageId: string): readonly string[] {
  const headers = [
    foldHeader("From", encodeHeaderValue(formatAddress(message.from))),
    foldHeader("To", message.to.map(formatAddress).map(encodeHeaderValue).join(", ")),
    ...(message.cc.length === 0 ? [] : [foldHeader("Cc", message.cc.map(formatAddress).map(encodeHeaderValue).join(", "))]),
    ...(message.replyTo.length === 0 ? [] : [foldHeader("Reply-To", message.replyTo.map(formatAddress).map(encodeHeaderValue).join(", "))]),
    foldHeader("Subject", encodeHeaderValue(message.subject)),
    foldHeader("Message-ID", `<${messageId}>`),
    foldHeader("Date", new Date().toUTCString()),
    foldHeader("MIME-Version", "1.0"),
  ];
  const custom = Object.entries(message.headers).map(([name, value]) =>
    foldHeader(validateHeaderName(name), encodeHeaderValue(validateHeaderValue(value, name))));
  return Object.freeze([...headers, ...custom]);
}

/** Encodes a normalized message into immutable RFC 5322 MIME text. */
export function encodeEmailMessage(message: NormalizedEmailMessage, messageId: string): EncodedEmail {
  const body = bodyFor(message);
  const raw = `${headersFor(message, messageId).join("\r\n")}\r\n${body.includes("Content-Type:") ? "\r\n" : "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"}${body}`;
  const recipients = Object.freeze([...message.to, ...message.cc, ...message.bcc]);
  return Object.freeze({
    messageId,
    envelope: Object.freeze({ from: message.from, recipients }),
    message,
    raw,
    size: new TextEncoder().encode(raw).byteLength,
  });
}
