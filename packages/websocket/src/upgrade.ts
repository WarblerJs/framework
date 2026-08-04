import type { CompiledSocketGraph } from "./compiled";
import type { NormalizedWebSocketConfig } from "./config";
import { WebSocketOriginError, WebSocketProtocolError, WebSocketUpgradeError } from "./errors";
/** Compact immutable data stored in Bun `ws.data`. */
export interface WarblerSocketData<TUser = unknown> {
  readonly connectionId: string; readonly graphId: number; readonly controllerId: number; readonly connectedAt: number;
  readonly user?: TUser; readonly metadata: Readonly<Record<string, unknown>>;
}
/** Application authentication result produced before upgrade. */
export type SocketAuthenticationResult<TUser = unknown> = Readonly<{ authenticated: true; user?: TUser; metadata?: Readonly<Record<string, unknown>> }> | Readonly<{ authenticated: false; status?: 401 | 403 }>;
/** Upgrade authentication hook. */
export type SocketAuthenticator<TUser = unknown> = (request: Request) => SocketAuthenticationResult<TUser> | Promise<SocketAuthenticationResult<TUser>>;
/** Minimal Bun upgrade server contract. */
export interface SocketUpgradeServer<TData> { upgrade(request: Request, options: { readonly headers?: Headers | Readonly<Record<string, string>>; readonly data: TData }): boolean }
/** Strictly validates request method and upgrade headers. */
export function validateUpgradeRequest(request: Request): void {
  if (request.method !== "GET") throw new WebSocketUpgradeError("WebSocket upgrade requires GET");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new WebSocketUpgradeError("Invalid WebSocket upgrade header");
  const connection = request.headers.get("connection")?.split(",").some((part) => part.trim().toLowerCase() === "upgrade");
  if (!connection) throw new WebSocketUpgradeError("Invalid WebSocket connection header");
}
/** Validates an exact browser Origin policy. */
export function validateOrigin(request: Request, policy: NormalizedWebSocketConfig["origins"]): void {
  const value = request.headers.get("origin");
  if (value === null) { if (policy.required) throw new WebSocketOriginError("Origin is required"); return; }
  let normalized: string;
  try { normalized = new URL(value).origin; } catch { throw new WebSocketOriginError("Malformed Origin"); }
  if (normalized !== value || !policy.allowed.has(normalized)) throw new WebSocketOriginError("Origin is not allowed");
}
/** Selects only an explicitly allowed requested subprotocol. */
export function validateSubprotocol(request: Request, policy: NormalizedWebSocketConfig["protocols"]): string | undefined {
  const header = request.headers.get("sec-websocket-protocol");
  if (header === null) { if (policy.required) throw new WebSocketProtocolError("Subprotocol is required"); return; }
  const requested = header.split(",").map((item) => item.trim()).filter(Boolean);
  const selected = requested.find((item) => policy.allowed.includes(item));
  if (selected === undefined && policy.required) throw new WebSocketProtocolError("No supported subprotocol");
  return selected;
}
/** Creates frozen compact per-connection data. */
export function createConnectionData<TUser>(graph: CompiledSocketGraph, authentication: SocketAuthenticationResult<TUser>): WarblerSocketData<TUser> {
  if (!authentication.authenticated) throw new WebSocketUpgradeError("Authentication rejected");
  return Object.freeze({ connectionId: crypto.randomUUID(), graphId: graph.graphId, controllerId: graph.controllerId, connectedAt: Date.now(), user: authentication.user, metadata: Object.freeze({ ...(authentication.metadata ?? {}) }) });
}
/** Creates a shared/dedicated Bun fetch handler for compiled graph prefixes. */
export function createSocketUpgradeHandler<TUser>(graphs: readonly CompiledSocketGraph[], config: NormalizedWebSocketConfig, authenticate?: SocketAuthenticator<TUser>) {
  const paths = new Map(graphs.map((graph) => [normalizePrefix(graph.prefix), graph]));
  return (request: Request, server: SocketUpgradeServer<WarblerSocketData<TUser>>): Response | undefined | Promise<Response | undefined> => {
    const graph = paths.get(new URL(request.url).pathname);
    if (graph === undefined) return new Response("Not Found", { status: 404 });
    try { validateUpgradeRequest(request); validateHost(request, config.hosts); validateOrigin(request, config.origins); } catch (error) { return upgradeFailure(error); }
    let protocol: string | undefined;
    try { protocol = validateSubprotocol(request, config.protocols); } catch (error) { return upgradeFailure(error); }
    const result = authenticate?.(request) ?? { authenticated: !config.authentication.required };
    if (typeof result === "object" && result !== null && "then" in result) return result.then((auth) => complete(request, server, graph, auth, protocol), () => new Response("Unauthorized", { status: 401 }));
    return complete(request, server, graph, result, protocol);
  };
}
function complete<TUser>(request: Request, server: SocketUpgradeServer<WarblerSocketData<TUser>>, graph: CompiledSocketGraph, authentication: SocketAuthenticationResult<TUser>, protocol?: string): Response | undefined {
  if (!authentication.authenticated) return new Response(authentication.status === 403 ? "Forbidden" : "Unauthorized", { status: authentication.status ?? 401 });
  const headers = protocol === undefined ? undefined : { "Sec-WebSocket-Protocol": protocol };
  return server.upgrade(request, { headers, data: createConnectionData(graph, authentication) }) ? undefined : new Response("WebSocket upgrade failed.", { status: 400 });
}
function validateHost(request: Request, policy: NormalizedWebSocketConfig["hosts"]): void {
  const host = request.headers.get("host");
  if (host === null || !/^[A-Za-z0-9.\-:[\]]+$/u.test(host)) throw new WebSocketUpgradeError("Invalid Host");
  if (policy.required && !policy.allowed.has(host)) throw new WebSocketUpgradeError("Host is not allowed");
}
function upgradeFailure(error: unknown): Response {
  if (error instanceof WebSocketOriginError || error instanceof WebSocketProtocolError) return new Response("Forbidden", { status: 403 });
  return new Response("Bad Request", { status: 400 });
}
/** Normalizes a Graph prefix as an exact upgrade endpoint. */
export function normalizePrefix(prefix: string): string {
  if (!prefix.startsWith("/")) prefix = `/${prefix}`;
  if (prefix.length > 1 && prefix.endsWith("/")) prefix = prefix.slice(0, -1);
  return prefix;
}
