import { TransportKind, type TransportAdapter, type TransportStartContext, type TransportStopContext } from "@warbler/transport";
import type { CompiledSocketGraph } from "./compiled";
import type { NormalizedWebSocketConfig } from "./config";
import { createBunWebSocketHandler } from "./native";
import type { BunWebSocketServerHandle } from "./server";
import { WebSocketServerOwner } from "./server";
import { createSocketUpgradeHandler } from "./upgrade";
/** Shared HTTP integration receives an application-owned Bun server. */
export interface SharedWebSocketServer { readonly server: BunWebSocketServerHandle }
/** Native adapter handle for shared or dedicated operation. */
export interface WebSocketTransportHandle { readonly mode: "shared-http" | "dedicated"; readonly websocket: ReturnType<typeof createBunWebSocketHandler>; readonly fetch: ReturnType<typeof createSocketUpgradeHandler>; readonly owner?: WebSocketServerOwner }
/** Start config carrying normalized config and compiled graphs. */
export interface WebSocketAdapterConfig { readonly websocket: NormalizedWebSocketConfig; readonly graphs: readonly CompiledSocketGraph[]; readonly port?: number }
/** Bun-native WebSocket transport adapter. */
export class BunWebSocketAdapter implements TransportAdapter<WebSocketAdapterConfig, WebSocketTransportHandle, SharedWebSocketServer | undefined> {
  public readonly kind = TransportKind.WEBSOCKET;
  /** Builds shared handlers or starts one dedicated Bun server. */
  public start(context: TransportStartContext<WebSocketAdapterConfig, SharedWebSocketServer | undefined>): WebSocketTransportHandle {
    const { websocket: config, graphs } = context.config;
    const handler = createBunWebSocketHandler(graphs, config);
    const fetch = createSocketUpgradeHandler(graphs, config);
    if (config.mode === "shared-http") return Object.freeze({ mode: config.mode, websocket: handler, fetch });
    const port = context.config.port;
    if (!Number.isInteger(port) || port === undefined || port < 1 || port > 65535) throw new RangeError("Dedicated WebSocket port is invalid");
    const owner = new WebSocketServerOwner(() => Bun.serve({ port, fetch, websocket: handler }));
    owner.start();
    return Object.freeze({ mode: config.mode, websocket: handler, fetch, owner });
  }
  /** Stops a dedicated server; shared HTTP ownership remains external. */
  public stop(context: TransportStopContext<WebSocketTransportHandle, SharedWebSocketServer | undefined>): void | Promise<void> { return context.native.owner?.stop(true); }
}
