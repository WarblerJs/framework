import { parseByteSize, parseHost, parsePort } from "@warbler/config";
import { InvalidHttpConfigError } from "../errors";
import { HttpMethod } from "../route";
import type { NormalizedHttpConfig } from "./http-config.types";

type RecordValue = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string, optional = false): RecordValue {
  if (value === undefined && optional) return Object.freeze({});
  if (!isRecord(value)) throw new InvalidHttpConfigError(path, "must be an object");
  return value;
}

function positive(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidHttpConfigError(path, "must be a positive safe integer");
  }
  return value;
}

function byteSize(value: unknown, path: string, fallback: string): number {
  if (value === undefined) return parseByteSize(fallback);
  try {
    const parsed = typeof value === "number" ? value : parseByteSize(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new InvalidHttpConfigError(path, "must be positive");
    return parsed;
  } catch (error) {
    if (error instanceof InvalidHttpConfigError) throw error;
    throw new InvalidHttpConfigError(path, "must be a valid positive byte size");
  }
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new InvalidHttpConfigError(path, "must be a boolean");
  return value;
}

function stringValue(value: unknown, path: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new InvalidHttpConfigError(path, "must be a non-empty string without null bytes");
  }
  return value;
}

function strings(value: unknown, path: string, fallback: readonly string[] = []): readonly string[] {
  if (value === undefined) return Object.freeze([...fallback]);
  if (!Array.isArray(value)) throw new InvalidHttpConfigError(path, "must be an array");
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) throw new InvalidHttpConfigError(path, "entries must be non-empty strings");
    output.push(entry);
  }
  return Object.freeze(output);
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

/** Validates, normalizes, and deeply freezes HTTP transport configuration. */
export function normalizeHttpConfig(value: unknown): NormalizedHttpConfig {
  const root = record(value, "http");
  const request = record(root.request, "http.request", true);
  const body = record(request.body ?? root.body, "http.body", true);
  const json = record(body.json, "http.body.json", true);
  const text = record(body.text, "http.body.text", true);
  const urlEncoded = record(body.urlEncoded, "http.body.urlEncoded", true);
  const multipart = record(body.multipart, "http.body.multipart", true);
  const headers = record(request.headers, "http.request.headers", true);
  const query = record(request.query, "http.request.query", true);
  const cookies = record(request.cookies, "http.request.cookies", true);
  const path = record(request.path, "http.request.path", true);
  const timeouts = record(request.timeouts ?? root.timeouts, "http.timeouts", true);
  const security = record(root.security, "http.security", true);
  const csrf = record(root.csrf, "http.csrf", true);
  const staticPolicy = record(root.static, "http.static", true);
  const rateLimit = record(root.rateLimit, "http.rateLimit", true);
  const maxRequestBodySize = byteSize(root.maxRequestBodySize ?? body.maxSize, "http.maxRequestBodySize", "10mb");
  const unknownContentType = body.unknownContentType ?? "reject";
  if (unknownContentType !== "reject" && unknownContentType !== "ignore") {
    throw new InvalidHttpConfigError("http.body.unknownContentType", "must be reject or ignore");
  }
  const hostValue = root.host ?? "0.0.0.0";
  let host: string;
  try { host = parseHost(hostValue); } catch { throw new InvalidHttpConfigError("http.host", "must be a valid host"); }
  let port: number;
  try { port = parsePort(root.port ?? 3000); } catch { throw new InvalidHttpConfigError("http.port", "must be a valid port"); }
  const allowedHosts = strings(root.allowedHosts, "http.allowedHosts");
  for (const allowedHost of allowedHosts) {
    try { parseHost(allowedHost); } catch { throw new InvalidHttpConfigError("http.allowedHosts", "contains an invalid host"); }
  }
  const idleMilliseconds = positive(timeouts.idle, "http.timeouts.idle", 10_000);
  const frameOptions = security.frameOptions ?? "DENY";
  if (frameOptions !== "DENY" && frameOptions !== "SAMEORIGIN") {
    throw new InvalidHttpConfigError("http.security.frameOptions", "must be DENY or SAMEORIGIN");
  }
  const csrfMethodsRaw = csrf.methods ?? [HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE];
  if (!Array.isArray(csrfMethodsRaw) || csrfMethodsRaw.length === 0) {
    throw new InvalidHttpConfigError("http.csrf.methods", "must be a non-empty method array");
  }
  const csrfMethods: Array<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD"> = [];
  for (const method of csrfMethodsRaw) {
    if (
      method !== HttpMethod.GET && method !== HttpMethod.POST && method !== HttpMethod.PUT &&
      method !== HttpMethod.PATCH && method !== HttpMethod.DELETE &&
      method !== HttpMethod.OPTIONS && method !== HttpMethod.HEAD
    ) throw new InvalidHttpConfigError("http.csrf.methods", "contains an unsupported HTTP method");
    csrfMethods.push(method);
  }
  const csrfSourcesRaw = csrf.sources ?? ["header"];
  if (!Array.isArray(csrfSourcesRaw) || csrfSourcesRaw.length === 0) {
    throw new InvalidHttpConfigError("http.csrf.sources", "must be a non-empty token-source array");
  }
  const csrfSources: Array<"header" | "cookie" | "form" | "json"> = [];
  for (const source of csrfSourcesRaw) {
    if (source !== "header" && source !== "cookie" && source !== "form" && source !== "json") {
      throw new InvalidHttpConfigError("http.csrf.sources", "contains an unsupported token source");
    }
    csrfSources.push(source);
  }
  const normalized: NormalizedHttpConfig = {
    host,
    port,
    development: booleanValue(root.development, "http.development", false),
    reusePort: booleanValue(root.reusePort, "http.reusePort", false),
    idleTimeoutSeconds: Math.min(255, Math.ceil(idleMilliseconds / 1_000)),
    maxRequestBodySize,
    allowedHosts,
    body: {
      enabled: booleanValue(body.enabled, "http.body.enabled", true),
      maxSize: maxRequestBodySize,
      json: {
        enabled: booleanValue(json.enabled, "http.body.json.enabled", true),
        maxSize: byteSize(json.maxSize, "http.body.json.maxSize", "1mb"),
        maxDepth: positive(json.maxDepth, "http.body.json.maxDepth", 12),
        maxKeys: positive(json.maxKeys, "http.body.json.maxKeys", 2_000),
      },
      text: {
        enabled: booleanValue(text.enabled, "http.body.text.enabled", true),
        maxSize: byteSize(text.maxSize, "http.body.text.maxSize", "1mb"),
      },
      urlEncoded: {
        enabled: booleanValue(urlEncoded.enabled, "http.body.urlEncoded.enabled", true),
        maxSize: byteSize(urlEncoded.maxSize, "http.body.urlEncoded.maxSize", "1mb"),
        maxFields: positive(urlEncoded.maxFields, "http.body.urlEncoded.maxFields", 1_000),
        maxFieldSize: byteSize(urlEncoded.maxFieldSize, "http.body.urlEncoded.maxFieldSize", "64kb"),
      },
      multipart: {
        enabled: booleanValue(multipart.enabled, "http.body.multipart.enabled", true),
        maxSize: byteSize(multipart.maxSize, "http.body.multipart.maxSize", "20mb"),
        maxFiles: positive(multipart.maxFiles, "http.body.multipart.maxFiles", 10),
        maxFileSize: byteSize(multipart.maxFileSize, "http.body.multipart.maxFileSize", "5mb"),
        maxFields: positive(multipart.maxFields, "http.body.multipart.maxFields", 100),
        maxFieldSize: byteSize(multipart.maxFieldSize, "http.body.multipart.maxFieldSize", "64kb"),
        allowedMimeTypes: strings(multipart.allowedMimeTypes, "http.body.multipart.allowedMimeTypes"),
      },
      unknownContentType,
    },
    security: {
      enabled: booleanValue(security.enabled, "http.security.enabled", true),
      contentSecurityPolicy: stringValue(security.contentSecurityPolicy, "http.security.contentSecurityPolicy", "default-src 'self'"),
      strictTransportSecurity: stringValue(security.strictTransportSecurity, "http.security.strictTransportSecurity", "max-age=31536000; includeSubDomains"),
      frameOptions,
      contentTypeOptions: "nosniff",
      referrerPolicy: stringValue(security.referrerPolicy, "http.security.referrerPolicy", "strict-origin-when-cross-origin"),
      permissionsPolicy: stringValue(security.permissionsPolicy, "http.security.permissionsPolicy", "camera=(), microphone=(), geolocation=()"),
      crossOriginOpenerPolicy: stringValue(security.crossOriginOpenerPolicy, "http.security.crossOriginOpenerPolicy", "same-origin"),
      crossOriginResourcePolicy: stringValue(security.crossOriginResourcePolicy, "http.security.crossOriginResourcePolicy", "same-origin"),
      crossOriginEmbedderPolicy: stringValue(security.crossOriginEmbedderPolicy, "http.security.crossOriginEmbedderPolicy", "require-corp"),
    },
    forwarded: {
      trustProxy: booleanValue(rateLimit.trustProxy, "http.forwarded.trustProxy", false),
      trustedProxies: strings(rateLimit.trustedProxies, "http.forwarded.trustedProxies"),
    },
    limits: {
      headers: {
        maxCount: positive(headers.maxCount, "http.request.headers.maxCount", 100),
        maxSize: byteSize(headers.maxSize, "http.request.headers.maxSize", "32kb"),
        maxNameSize: byteSize(headers.maxNameSize, "http.request.headers.maxNameSize", "256b"),
        maxValueSize: byteSize(headers.maxValueSize, "http.request.headers.maxValueSize", "8kb"),
      },
      query: {
        maxParameters: positive(query.maxParameters, "http.request.query.maxParameters", 100),
        maxDepth: positive(query.maxDepth, "http.request.query.maxDepth", 8),
      },
      cookies: {
        maxCount: positive(cookies.maxCount, "http.request.cookies.maxCount", 50),
        maxSize: byteSize(cookies.maxSize, "http.request.cookies.maxSize", "8kb"),
      },
      path: {
        maxSize: byteSize(path.maxSize, "http.request.path.maxSize", "8kb"),
        maxParams: positive(path.maxParams ?? path.maxParameters, "http.request.path.maxParams", 32),
      },
    },
    timeouts: {
      headers: positive(timeouts.headers, "http.timeouts.headers", 5_000),
      body: positive(timeouts.body, "http.timeouts.body", 30_000),
      request: positive(timeouts.request, "http.timeouts.request", 60_000),
    },
    csrf: {
      enabled: booleanValue(csrf.enabled, "http.csrf.enabled", false),
      methods: Object.freeze(csrfMethods),
      headerName: stringValue(csrf.headerName, "http.csrf.headerName", "x-csrf-token").toLowerCase(),
      cookieName: stringValue(csrf.cookieName, "http.csrf.cookieName", "__Host-warbler-csrf"),
      sources: Object.freeze(csrfSources),
      strictSources: booleanValue(csrf.strictSources, "http.csrf.strictSources", true),
    },
    static: {
      enabled: booleanValue(staticPolicy.enabled, "http.static.enabled", false),
      root: stringValue(staticPolicy.root, "http.static.root", "public"),
      prefix: stringValue(staticPolicy.prefix, "http.static.prefix", "/"),
      indexFiles: strings(staticPolicy.indexFiles, "http.static.indexFiles", ["index.html"]),
      exposeDotfiles: booleanValue(staticPolicy.exposeDotfiles, "http.static.exposeDotfiles", false),
      exposeSourceMaps: booleanValue(staticPolicy.exposeSourceMaps, "http.static.exposeSourceMaps", false),
      cacheControl: Object.freeze({
        enabled: booleanValue(record(staticPolicy.cacheControl, "http.static.cacheControl", true).enabled, "http.static.cacheControl.enabled", true),
        immutableAssets: booleanValue(record(staticPolicy.cacheControl, "http.static.cacheControl", true).immutableAssets, "http.static.cacheControl.immutableAssets", true),
      }),
    },
  };
  if (normalized.body.json.maxSize > maxRequestBodySize || normalized.body.text.maxSize > maxRequestBodySize || normalized.body.urlEncoded.maxSize > maxRequestBodySize) {
    throw new InvalidHttpConfigError("http.body", "format size limits must not exceed total max size");
  }
  deepFreeze(normalized);
  return normalized;
}

/** Validates HTTP configuration without retaining the normalized result. */
export function validateHttpConfig(value: unknown): void {
  normalizeHttpConfig(value);
}
