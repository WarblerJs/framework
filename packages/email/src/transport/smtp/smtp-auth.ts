import { encoding } from "@warblerjs/crypto";
import type { SmtpAuthConfig } from "../../config";

/** Creates an AUTH PLAIN payload without exposing credentials in logs or errors. */
export function authPlainPayload(auth: SmtpAuthConfig): string {
  return encoding.encodeBase64(new TextEncoder().encode(`\0${auth.username}\0${auth.password}`));
}

/** Encodes one AUTH LOGIN credential challenge response. */
export function authLoginPayload(value: string): string {
  return encoding.encodeBase64(new TextEncoder().encode(value));
}
