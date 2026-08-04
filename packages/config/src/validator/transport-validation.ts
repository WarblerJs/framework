import { ConfigError } from "../errors";
import { parseByteSize, parseDuration, parseHost, parsePort } from "../parser";
import type { TransportName } from "../types";
import { array, booleanValue, integer, oneOf, pathValue, record, stringValue } from "../utils/validation";

// "limit"/"totalLimit" are included because Warbler's HTTP body policy (json.limit, text.limit,
// urlEncoded.limit, multipart.totalLimit, ...) names its byte-size fields this way. A key matching
// this pattern is *always* size-validated below — matching the pattern is not itself proof the
// value is well-formed, so the string content still has to pass parseByteSize.
const SIZE_KEY = /(?:size|buffer|threshold|length|bytes|limit)$/iu;
const DURATION_KEY = /(?:ms|timeout|interval|window)$/iu;

/** Re-throws a parser's ConfigError with the tree-walk path attached, so failures are locatable. */
function rethrowWithPath(error: unknown, path: string): never {
  if (!(error instanceof ConfigError)) throw error;
  throw new ConfigError(error.message, path, { cause: error });
}

function validateTree(value: unknown, path: string, key: string): void {
  if (value === null || value === undefined) throw new ConfigError("must be defined", path);
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    integer(value, path);
    return;
  }
  if (typeof value === "string") {
    stringValue(value, path);
    // Every key shaped like a byte-size or duration field is parsed unconditionally — never only
    // when the value already happens to look well-formed. A malformed value on one of these keys
    // (a bare number with no unit, a negative amount, an unknown unit, garbage text) must fail
    // config validation here rather than silently surviving as "just a string".
    if (SIZE_KEY.test(key)) {
      try {
        parseByteSize(value);
      } catch (error) {
        rethrowWithPath(error, path);
      }
    } else if (DURATION_KEY.test(key)) {
      try {
        parseDuration(value);
      } catch (error) {
        rethrowWithPath(error, path);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) validateTree(value[index], `${path}[${index}]`, key);
    return;
  }
  const object = record(value, path);
  const keys = Object.keys(object);
  if (keys.length === 0 && key !== "perRoute") return;
  for (const childKey of keys) validateTree(object[childKey], `${path}.${childKey}`, childKey);
}

function requireSections(value: unknown, name: TransportName, sections: readonly string[]): Readonly<Record<string, unknown>> {
  const root = record(value, name);
  for (const section of sections) {
    if (!(section in root)) throw new ConfigError("is required", `${name}.${section}`);
  }
  for (const key of Object.keys(root)) {
    if (!sections.includes(key)) throw new ConfigError("is not supported", `${name}.${key}`);
  }
  validateTree(root, name, name);
  return root;
}

export function validateHttp(value: unknown): void {
  const root = record(value, "http");
  const modernKeys = ["host", "port", "allowedHosts", "request", "body", "timeouts", "security", "csrf", "static", "rateLimit", "maxRequestBodySize", "development", "reusePort"];
  for (const key of Object.keys(root)) {
    if (!modernKeys.includes(key)) throw new ConfigError("is not supported", `http.${key}`);
  }
  validateTree(root, "http", "http");
  if (!("request" in root)) throw new ConfigError("is required", "http.request");
  const request = record(root.request, "http.request");
  const body: Readonly<Record<string, unknown>> = request.body === undefined ? Object.freeze({}) : record(request.body, "http.request.body");
  if (body.unknownContentType !== undefined) {
    oneOf(body.unknownContentType, ["reject", "ignore"] as const, "http.request.body.unknownContentType");
  }
  // Bun.serve's idleTimeout is a whole-second value capped at 255 (it's stored as a uint8) — Bun
  // throws at startup, not per-request, if this is exceeded. `idle` is expressed in milliseconds
  // here like its sibling timeout fields, so the bound below is 255 seconds converted to ms. The
  // generic key-name tree walker can't know this Bun-specific ceiling, so it's checked explicitly.
  const timeouts: Readonly<Record<string, unknown>> = request.timeouts === undefined ? Object.freeze({}) : record(request.timeouts, "http.request.timeouts");
  if (timeouts.idle !== undefined) integer(timeouts.idle, "http.request.timeouts.idle", 0, 255_000);
  const rateLimit: Readonly<Record<string, unknown>> = root.rateLimit === undefined ? Object.freeze({}) : record(root.rateLimit, "http.rateLimit");
  if (rateLimit.onExceeded !== undefined) oneOf(rateLimit.onExceeded, ["reject"] as const, "http.rateLimit.onExceeded");
  if (rateLimit.statusCode !== undefined) integer(rateLimit.statusCode, "http.rateLimit.statusCode", 400, 599);
}

export function validateWebsocket(value: unknown): void {
  const root = record(value, "websocket");
  const modernKeys = ["mode", "port", "security", "messages", "compression", "timeouts", "backpressure", "limits", "bun"];
  if (Object.keys(root).some((key) => modernKeys.includes(key))) {
    for (const key of Object.keys(root)) if (!modernKeys.includes(key)) throw new ConfigError("is not supported", `websocket.${key}`);
    validateTree(root, "websocket", "websocket");
    if (root.mode !== undefined) oneOf(root.mode, ["shared-http", "dedicated"] as const, "websocket.mode");
    return;
  }
  const legacy = requireSections(value, "websocket", ["connection", "rateLimit"]);
  const rateLimit = record(legacy.rateLimit, "websocket.rateLimit");
  oneOf(rateLimit.onExceeded, ["reject_handshake", "close_socket", "throttle"] as const, "websocket.rateLimit.onExceeded");
  integer(rateLimit.closeCode, "websocket.rateLimit.closeCode", 1000, 4999);
}

export function validateTcp(value: unknown): void {
  const root = requireSections(value, "tcp", ["socket", "framing", "rateLimit"]);
  const framing = record(root.framing, "tcp.framing");
  oneOf(framing.type, ["length_delimited", "delimiter_based"] as const, "tcp.framing.type");
}

export function validateUdp(value: unknown): void {
  const root = requireSections(value, "udp", ["socket", "sessionTracking", "rateLimit"]);
  const rateLimit = record(root.rateLimit, "udp.rateLimit");
  oneOf(rateLimit.onExceeded, ["silent_drop"] as const, "udp.rateLimit.onExceeded");
}

export function validateMcp(value: unknown): void {
  const root = requireSections(value, "mcp", ["protocol", "transport", "jsonRpc", "capabilities", "rateLimit"]);
  const protocol = record(root.protocol, "mcp.protocol");
  oneOf(protocol.role, ["server", "client"] as const, "mcp.protocol.role");
  const transport = record(root.transport, "mcp.transport");
  oneOf(transport.layer, ["sse", "stdio"] as const, "mcp.transport.layer");
  const rateLimit = record(root.rateLimit, "mcp.rateLimit");
  oneOf(rateLimit.onExceeded, ["error_response"] as const, "mcp.rateLimit.onExceeded");
}

export function validateWebrtc(value: unknown): void {
  const root = requireSections(value, "webrtc", ["signaling", "ice", "dataChannels", "media"]);
  const signaling = record(root.signaling, "webrtc.signaling");
  oneOf(signaling.connectionType, ["websocket"] as const, "webrtc.signaling.connectionType");
  const ice = record(root.ice, "webrtc.ice");
  const range = record(ice.portRange, "webrtc.ice.portRange");
  const minimum = parsePort(range.min);
  const maximum = parsePort(range.max);
  if (minimum > maximum) throw new ConfigError("minimum must not exceed maximum", "webrtc.ice.portRange");
  const servers = array(ice.iceServers, "webrtc.ice.iceServers");
  if (servers.length === 0) throw new ConfigError("must contain at least one server", "webrtc.ice.iceServers");
  for (let index = 0; index < servers.length; index++) {
    const server = record(servers[index], `webrtc.ice.iceServers[${index}]`);
    const urls = array(server.urls, `webrtc.ice.iceServers[${index}].urls`);
    if (urls.length === 0) throw new ConfigError("must not be empty", `webrtc.ice.iceServers[${index}].urls`);
  }
}
