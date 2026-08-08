import { createHmac } from "node:crypto";
import { parseCookies } from "../cookies";
import { InvalidHttpConfigError } from "../errors";
import type { HttpMethodValue } from "../route";
import type { CsrfPolicy, CsrfVerification } from "./csrf-policy";
import type { CsrfTokenSource } from "./csrf-token-source";

const ENCODER = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  const a = ENCODER.encode(left);
  const b = ENCODER.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

// The "form"/"json" sources read the request body — unlike headers/cookies, a body has
// no size cap enforced yet this early in the pipeline (the real body-size policy runs
// later, inside the validated handler pipeline). Reject anything over a small fixed
// ceiling up front, from the declared Content-Length alone, before ever buffering it —
// a CSRF-carrying form/JSON payload is never legitimately large.
const MAX_CSRF_BODY_SOURCE_BYTES = 1_048_576;

/**
 * Reads the CSRF field out of a *clone* of the request body — `Request.clone()` tees
 * the underlying stream, so this never disturbs the original request's body for the
 * real handler pipeline's own (later, size-limited) body parsing.
 */
async function readBodyToken(request: Request, fieldName: string, kind: "form" | "json"): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0 || declaredLength > MAX_CSRF_BODY_SOURCE_BYTES) return undefined;
  try {
    if (kind === "form") {
      const value = (await request.clone().formData()).get(fieldName);
      return typeof value === "string" ? value : undefined;
    }
    const parsed: unknown = await request.clone().json();
    const value = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[fieldName] : undefined;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cached CSRF HMAC verifier that imports key material only once.
 *
 * Uses `node:crypto`'s synchronous HMAC (rather than `crypto.subtle`, which is
 * inherently async) so a fresh CSRF token can be minted synchronously during template
 * rendering (`csrfField`/`csrfToken`/`csrf()` are not awaited by callers). HMAC-SHA256
 * is deterministic — this produces byte-identical signatures to the Web Crypto
 * implementation it replaces, so the wire format and security properties are unchanged.
 */
export class CsrfVerifier {
  readonly #secret: Uint8Array;

  private constructor(secret: Uint8Array) {
    this.#secret = secret;
  }

  /** Imports CSRF secret material once during startup. */
  public static async create(secret: string): Promise<CsrfVerifier> {
    if (secret.length < 32) throw new InvalidHttpConfigError("http.csrf.secret", "must contain at least 32 characters");
    return new CsrfVerifier(ENCODER.encode(secret));
  }

  /** Synchronously signs a token using the cached secret. */
  public signSync(token: string): string {
    const signature = createHmac("sha256", this.#secret).update(token).digest();
    return `${token}.${new Uint8Array(signature).toBase64({ alphabet: "base64url", omitPadding: true })}`;
  }

  /** Creates a signed CSRF token using the cached key. */
  public async sign(token: string): Promise<string> {
    return this.signSync(token);
  }

  /** Verifies an unsafe request with one HMAC operation after source selection. */
  public async verify(request: Request, policy: CsrfPolicy, force?: boolean): Promise<CsrfVerification> {
    if (!policy.enabled && force !== true) return Object.freeze({ valid: true, reason: "disabled" });
    let protectedMethod = false;
    for (const method of policy.methods) if (request.method === method) protectedMethod = true;
    if (force !== true && !protectedMethod) {
      return Object.freeze({ valid: true, reason: "safe-method" });
    }
    const candidates: Array<Readonly<{ source: CsrfTokenSource; value: string }>> = [];
    if (policy.sources.includes("header")) {
      const header = request.headers.get(policy.headerName);
      if (header !== null) candidates.push({ source: "header", value: header });
    }
    if (policy.sources.includes("cookie")) {
      const cookie = parseCookies(request.headers.get("cookie"))[policy.cookieName];
      if (cookie !== undefined) candidates.push({ source: "cookie", value: cookie });
    }
    if (policy.sources.includes("form")) {
      const value = await readBodyToken(request, policy.fieldName, "form");
      if (value !== undefined) candidates.push({ source: "form", value });
    }
    if (policy.sources.includes("json")) {
      const value = await readBodyToken(request, policy.fieldName, "json");
      if (value !== undefined) candidates.push({ source: "json", value });
    }
    if (candidates.length === 0) return Object.freeze({ valid: false, reason: "missing" });
    if (policy.strictSources && candidates.length > 1) return Object.freeze({ valid: false, reason: "conflict" });
    const winner = candidates[0];
    if (winner === undefined) return Object.freeze({ valid: false, reason: "missing" });
    const separator = winner.value.lastIndexOf(".");
    if (separator <= 0) return Object.freeze({ valid: false, reason: "invalid" });
    const token = winner.value.slice(0, separator);
    const expected = this.signSync(token);
    const valid = constantTimeEqual(expected, winner.value);
    return valid
      ? Object.freeze({ valid: true, source: winner.source })
      : Object.freeze({ valid: false, reason: "invalid" });
  }
}
