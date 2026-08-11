import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { normalizeEmailConfig, type EmailConfigInput, type EmailConfig } from "./config";
import { createMessageId, normalizeEmailMessage } from "./message";
import { encodeEmailMessage } from "./mime/encode-message";
import type { EmailMessage, EmailSendResult, EmailTransport } from "./email.types";
import { compiledViewEmailRenderer, type EmailTemplateRenderer } from "./template/renderer";
import { LogTransport } from "./transport/log/log-transport";
import { MemoryTransport } from "./transport/memory/memory-transport";
import { SMTPTransport } from "./transport/smtp/smtp-transport";
import { EmailConfigurationError, EmailEncodingError } from "./errors";

function resolveTransport(config: EmailConfig): EmailTransport {
  if (config.customTransport !== undefined) return config.customTransport;
  if (config.transport === "log") return new LogTransport(config.logBodies);
  if (config.transport === "memory") return new MemoryTransport();
  if (config.smtp === undefined) throw new EmailConfigurationError("SMTP transport requires smtp configuration.");
  return new SMTPTransport(config.smtp);
}

async function loadProjectMailConfig(projectRoot = process.cwd()): Promise<EmailConfigInput> {
  const path = resolve(projectRoot, "src/config/mail.config.ts");
  if (!(await Bun.file(path).exists())) return Object.freeze({});
  const module = await import(pathToFileURL(path).href) as {
    readonly mailConfig?: EmailConfigInput;
    readonly default?: EmailConfigInput;
  };
  return module.mailConfig ?? module.default ?? Object.freeze({});
}

/** Production email service for validated, encoded, transport-independent sends. */
export class Email {
  private config: EmailConfig | undefined;
  private readonly renderer: EmailTemplateRenderer;
  private transport: EmailTransport | undefined;
  private readonly input: EmailConfigInput | undefined;

  public constructor(config?: EmailConfigInput, renderer: EmailTemplateRenderer = compiledViewEmailRenderer, transport?: EmailTransport) {
    this.input = config;
    this.renderer = renderer;
    this.transport = transport;
  }

  /** Normalizes, renders, MIME-encodes, and sends one message with one transport attempt. */
  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const { config, transport } = await this.resolved();
    const normalized = await normalizeEmailMessage(message, config, this.renderer);
    const messageId = createMessageId(config.messageIdDomain);
    const encoded = encodeEmailMessage(normalized, messageId);
    if (encoded.size > config.limits.messageBytes) throw new EmailEncodingError("Email exceeds configured total message size limit.");
    return transport.send(encoded);
  }

  /** Exposes the resolved transport for tests without mutating global state. */
  public getTransport(): EmailTransport {
    if (this.transport !== undefined) return this.transport;
    const config = this.config ?? normalizeEmailConfig(this.input ?? Object.freeze({}));
    this.config = config;
    this.transport = resolveTransport(config);
    return this.transport;
  }

  private async resolved(): Promise<{ readonly config: EmailConfig; readonly transport: EmailTransport }> {
    if (this.config !== undefined && this.transport !== undefined) return Object.freeze({ config: this.config, transport: this.transport });
    const input = this.input ?? await loadProjectMailConfig();
    const config = normalizeEmailConfig(Object.freeze({ ...input, ...(this.transport === undefined ? {} : { customTransport: this.transport }) }));
    const transport = resolveTransport(config);
    this.config = config;
    this.transport = transport;
    return Object.freeze({ config, transport });
  }
}
