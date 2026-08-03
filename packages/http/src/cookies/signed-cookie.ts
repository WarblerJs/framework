import { InvalidRequestError } from "../errors";

const ENCODER = new TextEncoder();

function base64Url(bytes: ArrayBuffer): string {
  return new Uint8Array(bytes).toBase64({ alphabet: "base64url", omitPadding: true });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = ENCODER.encode(left);
  const b = ENCODER.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

/** Cached HMAC signer for cookie values. */
export class SignedCookie {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  /** Imports and caches signing key material once. */
  public static async create(secret: string): Promise<SignedCookie> {
    if (secret.length < 32) throw new InvalidRequestError("Cookie signing secret must contain at least 32 characters", 500);
    const key = await crypto.subtle.importKey("raw", ENCODER.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new SignedCookie(key);
  }

  /** Signs a cookie value with the cached HMAC key. */
  public async sign(value: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", this.#key, ENCODER.encode(value));
    return `${value}.${base64Url(signature)}`;
  }

  /** Verifies and returns a signed value using constant-time comparison. */
  public async verify(signed: string): Promise<string | undefined> {
    const separator = signed.lastIndexOf(".");
    if (separator <= 0) return undefined;
    const value = signed.slice(0, separator);
    const expected = await this.sign(value);
    return constantTimeEqual(expected, signed) ? value : undefined;
  }
}
