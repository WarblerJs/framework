import { describe, expect, spyOn, test } from "bun:test";
import { env } from "@warbler/config";
import { Email, EmailAddressError, EmailEncodingError, LogTransport, normalizeEmailConfig } from "../src";
import { createChunkedBase64Encoder, encodeBase64Mime, MemoryTransport, parseSmtpCapabilities, parseSmtpResponse } from "../src/testing";
import { encoding } from "@warbler/crypto";

const renderer = Object.freeze({
  render: (name: string, data: Readonly<Record<string, unknown>>) => `<p>${name}:${String(data.email)}</p>`,
});

describe("@warbler/email", () => {
  test("sends through memory transport and keeps bcc out of MIME headers", async () => {
    const transport = new MemoryTransport();
    const email = new Email({ transport: "memory", from: "Warbler <hello@example.test>" }, renderer, transport);
    const result = await email.send({
      to: "Ada <ada@example.test>",
      cc: ["cc@example.test"],
      bcc: ["secret@example.test"],
      replyTo: "support@example.test",
      subject: "Welcome",
      text: "Hello",
      headers: { "X-App": "Warbler" },
    });

    expect(result.accepted).toEqual(["ada@example.test", "cc@example.test", "secret@example.test"]);
    expect(transport.messages).toHaveLength(1);
    const raw = transport.messages[0]!.raw;
    expect(raw).toContain("To: Ada <ada@example.test>");
    expect(raw).toContain("Cc: cc@example.test");
    expect(raw).toContain("Reply-To: support@example.test");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(raw).not.toContain("\r\n\r\nContent-Type: text/plain; charset=utf-8");
    expect(raw).not.toContain("Bcc:");
    expect(raw).not.toContain("secret@example.test");
  });

  test("renders templates before MIME encoding", async () => {
    const transport = new MemoryTransport();
    const email = new Email({ transport: "memory" }, renderer, transport);
    await email.send({
      to: "user@example.test",
      subject: "Template",
      template: "mail.welcome",
      data: { email: "user@example.test" },
    });
    expect(transport.messages[0]!.message.html).toBe("<p>mail.welcome:user@example.test</p>");
  });

  test("sends text plus template as multipart alternative", async () => {
    const transport = new MemoryTransport();
    const email = new Email({ transport: "memory" }, renderer, transport);
    await email.send({
      to: "user@example.test",
      subject: "Template with text",
      text: "Welcome plain text",
      template: "mail.welcome",
      data: { email: "user@example.test" },
    });

    const raw = transport.messages[0]!.raw;
    expect(raw).toContain("MIME-Version: 1.0\r\nContent-Type: multipart/alternative;");
    expect(raw).not.toContain("MIME-Version: 1.0\r\n\r\nContent-Type: multipart/alternative;");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(raw).toContain("Welcome=20plain=20text");
    expect(raw).toContain("Content-Type: text/html; charset=utf-8");
    expect(transport.messages[0]!.message.html).toBe("<p>mail.welcome:user@example.test</p>");
  });

  test("encodes utf-8 subjects and inline/regular attachments", async () => {
    const transport = new MemoryTransport();
    const email = new Email({ transport: "memory" }, renderer, transport);
    await email.send({
      to: "user@example.test",
      subject: "Salut été",
      text: "Hello",
      html: "<img src=\"cid:logo\"><p>Hello</p>",
      attachments: [
        { filename: "logo.txt", content: "LOGO", contentId: "logo", disposition: "inline" },
        { filename: "invoice.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" },
      ],
    });
    const raw = transport.messages[0]!.raw;
    expect(raw).toContain("=?UTF-8?B?");
    expect(raw).toContain("multipart/related");
    expect(raw).toContain("Content-ID: <logo>");
    expect(raw).toContain("multipart/mixed");
  });

  test("requires text unless a template is provided", async () => {
    const email = new Email({ transport: "memory" }, renderer, new MemoryTransport());
    await expect(email.send({
      to: "user@example.test",
      subject: "Missing content",
      html: "<p>Hello</p>",
    } as unknown as Parameters<Email["send"]>[0])).rejects.toThrow("Email requires text when no template is provided.");

    await expect(email.send({
      to: "user@example.test",
      subject: "Template",
      template: "mail.welcome",
      data: { email: "user@example.test" },
    })).resolves.toMatchObject({ transport: "memory" });
  });

  test("log transport clearly marks messages as not delivered", async () => {
    const transport = new LogTransport();
    const email = new Email({ transport: "memory" }, renderer, transport);
    const info = spyOn(console, "info").mockImplementation(() => {});
    try {
      await email.send({ to: "user@example.test", subject: "Log", text: "Hello" });
      expect(info).toHaveBeenCalledWith("[warbler:email]", expect.objectContaining({
        transport: "log",
        delivery: "not_sent",
      }));
    } finally {
      info.mockRestore();
    }
  });

  test("rejects unsafe addresses and custom header injection", async () => {
    expect(() => new Email({ transport: "memory" })).not.toThrow();
    const email = new Email({ transport: "memory" }, renderer, new MemoryTransport());
    await expect(email.send({ to: "bad\r\n@example.test", subject: "x", text: "x" })).rejects.toBeInstanceOf(EmailAddressError);
    await expect(email.send({ to: "ok@example.test", subject: "x", text: "x", headers: { "X-Test": "a\r\nBcc: leak@example.test" } })).rejects.toBeInstanceOf(EmailEncodingError);
    await expect(email.send({ to: "ok@example.test", subject: "x", text: "x", headers: { Bcc: "leak@example.test" } })).rejects.toBeInstanceOf(EmailEncodingError);
  });

  test("chunked base64 preserves bytes across non-3-aligned boundaries", () => {
    const source = new Uint8Array(Array.from({ length: 257 }, (_, index) => index % 251));
    const encoder = createChunkedBase64Encoder();
    let encoded = "";
    for (let index = 0; index < source.byteLength; index += 5) encoded += encoder.push(source.slice(index, index + 5));
    encoded += encoder.finish();
    expect(encoding.decodeBase64(encoded.replace(/\r\n/gu, ""))).toEqual(source);
    expect(encoded.replace(/\r\n/gu, "")).toBe(encodeBase64Mime(source).replace(/\r\n/gu, ""));
  });

  test("parses multiline SMTP replies and capabilities incrementally", () => {
    const first = parseSmtpResponse("250-example.test\r\n250-SIZE 1024\r", 4096, 8192);
    expect(first.response).toBeUndefined();
    const second = parseSmtpResponse(`${first.rest}\n250 STARTTLS\r\n`, 4096, 8192);
    expect(second.response?.code).toBe(250);
    const capabilities = parseSmtpCapabilities(second.response!);
    expect(capabilities.get("SIZE")).toBe("1024");
    expect(capabilities.has("STARTTLS")).toBe(true);
  });

  test("normalizes the named mail.config.ts object shape", () => {
    const mailConfig = {
      default: "smtp",
      from: {
        address: env("MAIL_FROM_ADDRESS", "noreply@example.com"),
        name: env("MAIL_FROM_NAME", "Warbler"),
      },
      transports: {
        smtp: {
          host: env("MAIL_HOST", "127.0.0.1"),
          port: env.int("MAIL_PORT", 587),
          secure: env.bool("MAIL_SECURE", false),
          auth: {
            user: env.optional("MAIL_USERNAME"),
            password: env.optional("MAIL_PASSWORD"),
          },
          tls: {
            rejectUnauthorized: env.bool("MAIL_TLS_REJECT_UNAUTHORIZED", true),
          },
          timeoutMs: env.int("MAIL_TIMEOUT_MS", 10_000),
        },
        log: { enabled: true },
        memory: { enabled: false },
      },
      limits: {},
    } as const;
    const config = normalizeEmailConfig(mailConfig);
    expect(config.transport).toBe("smtp");
    expect(config.from).toEqual({ email: "noreply@example.com", name: "Warbler" });
    expect(config.smtp?.host).toBe("127.0.0.1");
    expect(config.smtp?.timeoutMs).toBe(10_000);
  });
});
