/** Configurable browser security header policy. */
export interface SecurityHeaderPolicy {
  readonly enabled: boolean;
  readonly contentSecurityPolicy: string;
  readonly strictTransportSecurity: string;
  readonly frameOptions: "DENY" | "SAMEORIGIN";
  readonly contentTypeOptions: "nosniff";
  readonly referrerPolicy: string;
  readonly permissionsPolicy: string;
  readonly crossOriginOpenerPolicy: string;
  readonly crossOriginResourcePolicy: string;
  readonly crossOriginEmbedderPolicy: string;
}

/** Creates one immutable startup-time security header template. */
export function createSecurityHeaderTemplate(policy: SecurityHeaderPolicy): Readonly<Record<string, string>> {
  if (!policy.enabled) return Object.freeze({});
  return Object.freeze({
    "content-security-policy": policy.contentSecurityPolicy,
    "strict-transport-security": policy.strictTransportSecurity,
    "x-frame-options": policy.frameOptions,
    "x-content-type-options": policy.contentTypeOptions,
    "referrer-policy": policy.referrerPolicy,
    "permissions-policy": policy.permissionsPolicy,
    "cross-origin-opener-policy": policy.crossOriginOpenerPolicy,
    "cross-origin-resource-policy": policy.crossOriginResourcePolicy,
    "cross-origin-embedder-policy": policy.crossOriginEmbedderPolicy,
  });
}

/** Applies a precomputed security-header template without overwriting explicit response headers. */
export function applySecurityHeaders(
  response: Response,
  template: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers(response.headers);
  for (const name of Object.keys(template)) {
    if (!headers.has(name)) {
      const value = template[name];
      if (value !== undefined) headers.set(name, value);
    }
  }
  headers.delete("x-powered-by");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
