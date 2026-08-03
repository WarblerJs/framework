import { parseCookies } from "../cookies";
import { InvalidHttpConfigError } from "../errors";
import type { HttpMethodValue } from "../route";
import type { CsrfPolicy, CsrfVerification } from "./csrf-policy";

const ENCODER = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  const a = ENCODER.encode(left);
  const b = ENCODER.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

/** Cached CSRF HMAC verifier that imports key material only once. */
export class CsrfVerifier {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  /** Imports CSRF secret material once during startup. */
  public static async create(secret: string): Promise<CsrfVerifier> {
    if (secret.length < 32) throw new InvalidHttpConfigError("http.csrf.secret", "must contain at least 32 characters");
    const key = await crypto.subtle.importKey("raw", ENCODER.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new CsrfVerifier(key);
  }

  /** Creates a signed CSRF token using the cached key. */
  public async sign(token: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", this.#key, ENCODER.encode(token));
    return `${token}.${new Uint8Array(signature).toBase64({ alphabet: "base64url", omitPadding: true })}`;
  }

  /** Verifies an unsafe request with one HMAC operation after source selection. */
  public async verify(request: Request, policy: CsrfPolicy, force?: boolean): Promise<CsrfVerification> {
    if (!policy.enabled && force !== true) return Object.freeze({ valid: true, reason: "disabled" });
    let protectedMethod = false;
    for (const method of policy.methods) if (request.method === method) protectedMethod = true;
    if (force !== true && !protectedMethod) {
      return Object.freeze({ valid: true, reason: "safe-method" });
    }
    const values: string[] = [];
    if (policy.sources.includes("header")) {
      const header = request.headers.get(policy.headerName);
      if (header !== null) values.push(header);
    }
    if (policy.sources.includes("cookie")) {
      const cookie = parseCookies(request.headers.get("cookie"))[policy.cookieName];
      if (cookie !== undefined) values.push(cookie);
    }
    if (values.length === 0) return Object.freeze({ valid: false, reason: "missing" });
    if (policy.strictSources && values.length > 1) return Object.freeze({ valid: false, reason: "conflict" });
    const submitted = values[0];
    if (submitted === undefined) return Object.freeze({ valid: false, reason: "missing" });
    const separator = submitted.lastIndexOf(".");
    if (separator <= 0) return Object.freeze({ valid: false, reason: "invalid" });
    const token = submitted.slice(0, separator);
    const expected = await this.sign(token);
    const valid = constantTimeEqual(expected, submitted);
    return valid
      ? Object.freeze({ valid: true })
      : Object.freeze({ valid: false, reason: "invalid" });
  }
}
