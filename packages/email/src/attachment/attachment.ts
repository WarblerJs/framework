import { basename, resolve } from "node:path";
import { EmailAttachmentError } from "../errors";
import type { EmailAttachment, NormalizedEmailAttachment } from "../email.types";
import type { EmailLimits } from "../config";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
});

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function contentTypeFor(filename: string): string {
  return MIME_BY_EXTENSION[extension(filename)] ?? "application/octet-stream";
}

function safeFilename(filename: string): string {
  if (/[\r\n\0/\\]/u.test(filename)) throw new EmailAttachmentError("Attachment filename is unsafe.");
  const trimmed = filename.trim();
  if (trimmed.length === 0) throw new EmailAttachmentError("Attachment filename cannot be empty.");
  return trimmed;
}

function safeContentId(contentId: string | undefined): string | undefined {
  if (contentId === undefined) return undefined;
  if (!/^[A-Za-z0-9_.@-]+$/u.test(contentId)) throw new EmailAttachmentError("Inline attachment contentId is invalid.");
  return contentId;
}

async function bytesFromContent(content: NonNullable<EmailAttachment["content"]>): Promise<Uint8Array> {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new Uint8Array(await content.arrayBuffer());
}

/** Normalizes and size-checks all attachments before transport I/O starts. */
export async function normalizeAttachments(input: readonly EmailAttachment[] | undefined, limits: EmailLimits): Promise<readonly NormalizedEmailAttachment[]> {
  const attachments = input ?? Object.freeze([]);
  if (attachments.length > limits.attachmentCount) throw new EmailAttachmentError("Too many email attachments.");
  let total = 0;
  const output: NormalizedEmailAttachment[] = [];
  for (const item of attachments) {
    if (item.path === undefined && item.content === undefined) throw new EmailAttachmentError("Attachment requires path or content.");
    if (item.path !== undefined && item.content !== undefined) throw new EmailAttachmentError("Attachment must not define both path and content.");
    const filename = safeFilename(item.filename ?? (item.path === undefined ? "attachment.bin" : basename(item.path)));
    let content: Uint8Array;
    if (item.path !== undefined) {
      const absolute = resolve(item.path);
      if (absolute.includes("/../") || /(?:^|\/)\.(?:env|git)(?:\/|$)/u.test(absolute) || absolute.includes("/node_modules/")) {
        throw new EmailAttachmentError("Attachment path is not allowed.");
      }
      const file = Bun.file(absolute);
      const size = file.size;
      if (size > limits.attachmentBytes) throw new EmailAttachmentError("Attachment exceeds per-file limit.");
      content = new Uint8Array(await file.arrayBuffer());
    } else {
      const contentInput = item.content;
      if (contentInput === undefined) throw new EmailAttachmentError("Attachment requires path or content.");
      content = await bytesFromContent(contentInput);
      if (content.byteLength > limits.attachmentBytes) throw new EmailAttachmentError("Attachment exceeds per-file limit.");
    }
    total += content.byteLength;
    if (total > limits.totalAttachmentBytes) throw new EmailAttachmentError("Attachments exceed total limit.");
    output.push(Object.freeze({
      filename,
      content,
      contentType: item.contentType ?? contentTypeFor(filename),
      contentId: safeContentId(item.contentId),
      disposition: item.disposition ?? (item.contentId === undefined ? "attachment" : "inline"),
    }));
  }
  return Object.freeze(output);
}
