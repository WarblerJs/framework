import { EmailAddressError } from "./errors";
import type { EmailAddress, EmailAddressInput } from "./email.types";

const EMAIL_PATTERN = /^[^\s<>"@(),:;\\[\]]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u;

function assertNoControl(value: string, label: string): string {
  if (/[\r\n\0]/u.test(value)) throw new EmailAddressError(`${label} contains forbidden control characters.`);
  return value;
}

/** Parses and validates a user-facing email address input. */
export function normalizeEmailAddress(input: EmailAddressInput): EmailAddress {
  if (typeof input !== "string") {
    const email = assertNoControl(input.email.trim(), "email address");
    const name = input.name === undefined ? undefined : assertNoControl(input.name.trim(), "display name");
    if (!EMAIL_PATTERN.test(email)) throw new EmailAddressError(`Invalid email address: ${email}`);
    return Object.freeze({ email: email.toLowerCase(), ...(name === undefined || name.length === 0 ? {} : { name }) });
  }
  const value = assertNoControl(input.trim(), "email address");
  const match = /^(?:"([^"]+)"|([^<"]+))?\s*<([^<>]+)>$/u.exec(value);
  if (match !== null) {
    const name = (match[1] ?? match[2] ?? "").trim();
    return normalizeEmailAddress({ email: match[3]!.trim(), ...(name.length === 0 ? {} : { name }) });
  }
  if (!EMAIL_PATTERN.test(value)) throw new EmailAddressError(`Invalid email address: ${value}`);
  return Object.freeze({ email: value.toLowerCase() });
}

/** Normalizes one-or-many address inputs into an immutable array. */
export function normalizeAddressList(input: EmailAddressInput | readonly EmailAddressInput[] | undefined): readonly EmailAddress[] {
  if (input === undefined) return Object.freeze([]);
  const values = Array.isArray(input) ? input : [input];
  return Object.freeze(values.map(normalizeEmailAddress));
}

function needsQuotedDisplayName(value: string): boolean {
  return /[",<>@;]/u.test(value);
}

function quoteDisplayName(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return needsQuotedDisplayName(value) ? `"${escaped}"` : escaped;
}

/** Formats a normalized address for MIME headers. */
export function formatAddress(address: EmailAddress): string {
  return address.name === undefined ? address.email : `${quoteDisplayName(address.name)} <${address.email}>`;
}

/** Formats a normalized address for SMTP envelope commands. */
export function formatPath(address: EmailAddress): string {
  return `<${address.email}>`;
}
