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

type SecurityHeaderEntry = readonly [name: string, value: string];
const SECURITY_HEADER_ENTRIES = Symbol("warbler.securityHeaderEntries");

interface CompiledSecurityHeaderTemplate extends Readonly<Record<string, string>> {
  readonly [SECURITY_HEADER_ENTRIES]?: readonly SecurityHeaderEntry[];
}

/** Creates one immutable startup-time security header template. */
export function createSecurityHeaderTemplate(policy: SecurityHeaderPolicy): Readonly<Record<string, string>> {
  if (!policy.enabled) return compiledTemplate(Object.freeze([]));
  const entries: readonly SecurityHeaderEntry[] = Object.freeze([
    securityHeaderEntry("content-security-policy", policy.contentSecurityPolicy),
    securityHeaderEntry("strict-transport-security", policy.strictTransportSecurity),
    securityHeaderEntry("x-frame-options", policy.frameOptions),
    securityHeaderEntry("x-content-type-options", policy.contentTypeOptions),
    securityHeaderEntry("referrer-policy", policy.referrerPolicy),
    securityHeaderEntry("permissions-policy", policy.permissionsPolicy),
    securityHeaderEntry("cross-origin-opener-policy", policy.crossOriginOpenerPolicy),
    securityHeaderEntry("cross-origin-resource-policy", policy.crossOriginResourcePolicy),
    securityHeaderEntry("cross-origin-embedder-policy", policy.crossOriginEmbedderPolicy),
  ]);
  return compiledTemplate(entries);
}

/** Applies a precomputed security-header template without overwriting explicit response headers. */
export function applySecurityHeaders(
  response: Response,
  template: Readonly<Record<string, string>>,
): Response {
  const entries = securityHeaderEntries(template);
  try {
    applyHeaderEntries(response.headers, entries);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    applyHeaderEntries(headers, entries);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

function compiledTemplate(entries: readonly SecurityHeaderEntry[]): Readonly<Record<string, string>> {
  const template: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let index = 0; index < entries.length; index++) {
    const [name, value] = entries[index]!;
    template[name] = value;
  }
  Object.defineProperty(template, SECURITY_HEADER_ENTRIES, {
    enumerable: false,
    value: entries,
  });
  return Object.freeze(template);
}

function securityHeaderEntry(name: string, value: string): SecurityHeaderEntry {
  return Object.freeze([name, value]);
}

function securityHeaderEntries(template: Readonly<Record<string, string>>): readonly SecurityHeaderEntry[] {
  const compiled = (template as CompiledSecurityHeaderTemplate)[SECURITY_HEADER_ENTRIES];
  if (compiled !== undefined) return compiled;
  const entries: SecurityHeaderEntry[] = [];
  const keys = Object.keys(template);
  for (let index = 0; index < keys.length; index++) {
    const name = keys[index]!;
    const value = template[name];
    if (value !== undefined) entries.push(Object.freeze([name, value]));
  }
  return Object.freeze(entries);
}

function applyHeaderEntries(headers: Headers, entries: readonly SecurityHeaderEntry[]): void {
  for (let index = 0; index < entries.length; index++) {
    const [name, value] = entries[index]!;
    if (!headers.has(name)) headers.set(name, value);
  }
  headers.delete("x-powered-by");
}
