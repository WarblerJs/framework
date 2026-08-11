import { env } from "@warbler/config";
import { EmailConfigurationError } from "./errors";
import type { EmailAddressInput, EmailTransport } from "./email.types";

/** Supported built-in transport names. */
export type EmailTransportName = "smtp" | "log" | "memory";
/** TLS policy for SMTP connections. */
export type SmtpTlsMode = "implicit" | "starttls" | "plain";

/** Mail limit settings used before transport I/O starts. */
export interface EmailLimits {
  readonly recipients: number;
  readonly subjectBytes: number;
  readonly customHeaders: number;
  readonly attachmentCount: number;
  readonly attachmentBytes: number;
  readonly totalAttachmentBytes: number;
  readonly messageBytes: number;
  readonly smtpResponseLineBytes: number;
  readonly smtpResponseBytes: number;
}

/** SMTP authentication configuration. */
export interface SmtpAuthConfig {
  readonly username: string;
  readonly password: string;
  readonly mechanism?: "plain" | "login";
}

/** SMTP connection and protocol configuration. */
export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly tls: SmtpTlsMode;
  readonly rejectUnauthorized: boolean;
  readonly allowPlain: boolean;
  readonly heloName: string;
  readonly auth?: SmtpAuthConfig;
  readonly timeoutMs: number;
  readonly responseLineBytes: number;
  readonly responseBytes: number;
}

/** Full email configuration accepted by Email. */
export interface EmailConfig {
  readonly transport: EmailTransportName;
  readonly from: EmailAddressInput;
  readonly messageIdDomain: string;
  readonly logBodies: boolean;
  readonly limits: EmailLimits;
  readonly smtp?: SmtpConfig;
  readonly customTransport?: EmailTransport;
}

/** SMTP settings accepted in `src/config/mail.config.ts`. */
export interface MailSmtpTransportConfig {
  readonly host?: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly auth?: {
    readonly user?: string;
    readonly password?: string;
  };
  readonly tls?: {
    readonly rejectUnauthorized?: boolean;
  };
  readonly timeoutMs?: number;
}

/** User-facing mail configuration shape exported from `src/config/mail.config.ts`. */
export interface MailConfigFile {
  readonly default?: EmailTransportName;
  readonly from?: EmailAddressInput | {
    readonly address?: string;
    readonly name?: string;
  };
  readonly transports?: {
    readonly smtp?: MailSmtpTransportConfig;
    readonly log?: { readonly enabled?: boolean; readonly logBodies?: boolean };
    readonly memory?: { readonly enabled?: boolean };
  };
  readonly limits?: Partial<EmailLimits>;
  readonly messageIdDomain?: string;
}

/** Partial normalized configuration accepted by direct construction. */
export interface DirectEmailConfigInput {
  readonly transport?: EmailTransportName;
  readonly from?: EmailAddressInput;
  readonly messageIdDomain?: string;
  readonly logBodies?: boolean;
  readonly limits?: Partial<EmailLimits>;
  readonly smtp?: Partial<SmtpConfig> & { readonly auth?: SmtpAuthConfig };
  readonly customTransport?: EmailTransport;
}

/** Mail configuration accepted by Email and tests. */
export type EmailConfigInput = DirectEmailConfigInput | MailConfigFile;

const DEFAULT_LIMITS: EmailLimits = Object.freeze({
  recipients: 100,
  subjectBytes: 998,
  customHeaders: 32,
  attachmentCount: 20,
  attachmentBytes: 25 * 1024 * 1024,
  totalAttachmentBytes: 40 * 1024 * 1024,
  messageBytes: 50 * 1024 * 1024,
  smtpResponseLineBytes: 4096,
  smtpResponseBytes: 128 * 1024,
});

function isMailConfigFile(input: EmailConfigInput): input is MailConfigFile {
  return "default" in input || "transports" in input;
}

function fromAddress(input: MailConfigFile["from"] | undefined): EmailAddressInput {
  if (input === undefined) return `${env("MAIL_FROM_NAME", "Warbler")} <${env("MAIL_FROM_ADDRESS", "noreply@example.com")}>`;
  if (typeof input === "string") return input;
  if ("email" in input) return input;
  return Object.freeze({
    email: input.address ?? env("MAIL_FROM_ADDRESS", "noreply@example.com"),
    name: input.name ?? env("MAIL_FROM_NAME", "Warbler"),
  });
}

function convertMailConfigFile(input: MailConfigFile): DirectEmailConfigInput {
  const transport = input.default ?? "smtp";
  const smtpInput = input.transports?.smtp;
  const username = smtpInput?.auth?.user;
  const password = smtpInput?.auth?.password;
  const auth = username !== undefined && password !== undefined
    ? Object.freeze({ username, password })
    : undefined;
  return Object.freeze({
    transport,
    from: fromAddress(input.from),
    messageIdDomain: input.messageIdDomain ?? "example.com",
    logBodies: input.transports?.log?.logBodies ?? false,
    limits: input.limits,
    ...(transport === "smtp" || smtpInput !== undefined ? {
      smtp: Object.freeze({
        host: smtpInput?.host ?? env("MAIL_HOST", "127.0.0.1"),
        port: smtpInput?.port ?? env.int("MAIL_PORT", 587),
        tls: smtpInput?.secure === true ? "implicit" as const : "starttls" as const,
        rejectUnauthorized: smtpInput?.tls?.rejectUnauthorized ?? env.bool("MAIL_TLS_REJECT_UNAUTHORIZED", true),
        allowPlain: false,
        heloName: "localhost",
        ...(auth === undefined ? {} : { auth }),
        timeoutMs: smtpInput?.timeoutMs ?? env.int("MAIL_TIMEOUT_MS", 10_000),
      }),
    } : {}),
  });
}

/** Normalizes mail configuration from explicit input and environment defaults. */
export function normalizeEmailConfig(input: EmailConfigInput = Object.freeze({})): EmailConfig {
  const direct = isMailConfigFile(input) ? convertMailConfigFile(input) : input;
  const transport = direct.transport ?? "smtp";
  if (transport !== "smtp" && transport !== "log" && transport !== "memory") {
    throw new EmailConfigurationError("Mail default transport must be smtp, log, or memory.");
  }
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...direct.limits });
  const smtpInput = direct.smtp;
  const smtp = smtpInput === undefined && transport !== "smtp" ? undefined : Object.freeze({
    host: smtpInput?.host ?? env("MAIL_HOST", "127.0.0.1"),
    port: smtpInput?.port ?? env.int("MAIL_PORT", 587),
    tls: smtpInput?.tls ?? "starttls",
    rejectUnauthorized: smtpInput?.rejectUnauthorized ?? env.bool("MAIL_TLS_REJECT_UNAUTHORIZED", true),
    allowPlain: smtpInput?.allowPlain ?? false,
    heloName: smtpInput?.heloName ?? env("MAIL_HELO", "localhost"),
    auth: smtpInput?.auth,
    timeoutMs: smtpInput?.timeoutMs ?? env.int("MAIL_TIMEOUT_MS", 10_000),
    responseLineBytes: smtpInput?.responseLineBytes ?? limits.smtpResponseLineBytes,
    responseBytes: smtpInput?.responseBytes ?? limits.smtpResponseBytes,
  } satisfies SmtpConfig);
  if (smtp !== undefined && smtp.tls !== "implicit" && smtp.tls !== "starttls" && smtp.tls !== "plain") {
    throw new EmailConfigurationError("MAIL_TLS must be implicit, starttls, or plain.");
  }
  if (smtp?.tls === "plain" && smtp.allowPlain !== true) {
    throw new EmailConfigurationError("Plain SMTP requires allowPlain: true.");
  }
  return Object.freeze({
    transport,
    from: direct.from ?? `${env("MAIL_FROM_NAME", "Warbler")} <${env("MAIL_FROM_ADDRESS", "noreply@example.com")}>`,
    messageIdDomain: direct.messageIdDomain ?? "example.com",
    logBodies: direct.logBodies ?? false,
    limits,
    ...(smtp === undefined ? {} : { smtp }),
    ...(direct.customTransport === undefined ? {} : { customTransport: direct.customTransport }),
  });
}
