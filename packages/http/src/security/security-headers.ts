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
type SecurityHeaderEntries = readonly string[];
const SECURITY_HEADER_ENTRIES = Symbol("warbler.securityHeaderEntries");

interface CompiledSecurityHeaderTemplate extends Readonly<Record<string, string>> {
  readonly [SECURITY_HEADER_ENTRIES]?: SecurityHeaderEntries;
}

/** Applies a startup-compiled security header policy to a response. */
export type SecurityHeaderApplicator = (response: Response) => Response;

/** Creates one immutable startup-time security header template. */
export function createSecurityHeaderTemplate(policy: SecurityHeaderPolicy): Readonly<Record<string, string>> {
  if (!policy.enabled) return compiledTemplate(Object.freeze([]));
  const entries: SecurityHeaderEntries = Object.freeze([
    "content-security-policy", policy.contentSecurityPolicy,
    "strict-transport-security", policy.strictTransportSecurity,
    "x-frame-options", policy.frameOptions,
    "x-content-type-options", policy.contentTypeOptions,
    "referrer-policy", policy.referrerPolicy,
    "permissions-policy", policy.permissionsPolicy,
    "cross-origin-opener-policy", policy.crossOriginOpenerPolicy,
    "cross-origin-resource-policy", policy.crossOriginResourcePolicy,
    "cross-origin-embedder-policy", policy.crossOriginEmbedderPolicy,
  ]);
  return compiledTemplate(entries);
}

/** Binds a security-header template once for route-handler startup paths. */
export function createSecurityHeaderApplicator(template: Readonly<Record<string, string>>): SecurityHeaderApplicator {
  const entries = securityHeaderEntries(template);
  return (response) => applySecurityHeaderEntries(response, entries);
}

/** Applies a precomputed security-header template without overwriting explicit response headers. */
export function applySecurityHeaders(
  response: Response,
  template: Readonly<Record<string, string>>,
): Response {
  return applySecurityHeaderEntries(response, securityHeaderEntries(template));
}

function applySecurityHeaderEntries(response: Response, entries: SecurityHeaderEntries): Response {
  try {
    applyHeaderEntries(response.headers, entries);
    return response;
  } catch {
  
    const headers = new Headers(response.headers);
    applyHeaderEntries(headers, entries);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

function compiledTemplate(entries: SecurityHeaderEntries): Readonly<Record<string, string>> {
  const template: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let index = 0; index < entries.length; index += 2) {
    const name = entries[index]!;
    const value = entries[index + 1]!;
    template[name] = value;
  }
  Object.defineProperty(template, SECURITY_HEADER_ENTRIES, {
    enumerable: false,
    value: entries,
  });
  return Object.freeze(template);
}

function securityHeaderEntries(template: Readonly<Record<string, string>>): SecurityHeaderEntries {
  const compiled = (template as CompiledSecurityHeaderTemplate)[SECURITY_HEADER_ENTRIES];
  if (compiled !== undefined) return compiled;
  const entries: string[] = [];
  const keys = Object.keys(template);
  for (let index = 0; index < keys.length; index++) {
    const name = keys[index]!;
    const value = template[name];
    if (value !== undefined) entries.push(name, value);
  }
  return Object.freeze(entries);
}

function applyHeaderEntries(headers: Headers, entries: SecurityHeaderEntries): void {
  for (let index = 0; index < entries.length; index += 2) {
    const name = entries[index]!;
    const value = entries[index + 1]!;
    if (!headers.has(name)) headers.set(name, value);
  }
  headers.delete("x-powered-by");
}
