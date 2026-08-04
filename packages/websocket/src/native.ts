import type { ServerWebSocket, WebSocketHandler } from "bun";
import { createSocketDispatcher, type CompiledSocketGraph } from "./compiled";
import type { NormalizedWebSocketConfig } from "./config";
import { createSocketContext } from "./context";
import type { WarblerSocketData } from "./upgrade";
/** Explicit Bun socket data used by native handlers. */
export type BunWebSocketData<TUser = unknown> = WarblerSocketData<TUser>;
/** Bun native WebSocket handler type. */
export type BunWebSocketHandler<TUser = unknown> = WebSocketHandler<BunWebSocketData<TUser>> & {
  /** Safe application error boundary supported by Bun runtimes exposing the callback. */
  error(socket: ServerWebSocket<BunWebSocketData<TUser>>, error: Error): void;
};
/** Builds Bun-native lifecycle handlers with safe error boundaries. */
export function createBunWebSocketHandler<TUser>(graphs: readonly CompiledSocketGraph[], config: NormalizedWebSocketConfig): BunWebSocketHandler<TUser> {
  const runtimes = new Map(graphs.map((graph) => [graph.graphId, { graph, dispatch: createSocketDispatcher(graph, config) }]));
  const context = (socket: ServerWebSocket<BunWebSocketData<TUser>>) => createSocketContext(socket, { id: socket.data.connectionId, connectedAt: socket.data.connectedAt }, { user: socket.data.user, format: config.messages.format, subscriptionLimit: config.limits.subscriptionsPerConnection });
  const fail = (socket: ServerWebSocket<BunWebSocketData<TUser>>): void => { try { socket.close(1011, "Internal WebSocket error"); } catch {} };
  return {
    idleTimeout: config.timeouts.idleSeconds,
    maxPayloadLength: config.messages.maxPayloadLength,
    backpressureLimit: config.backpressure.limitBytes,
    closeOnBackpressureLimit: config.backpressure.closeOnLimit,
    sendPings: config.bun.sendPings,
    publishToSelf: config.bun.publishToSelf,
    perMessageDeflate: config.compression.enabled,
    open(socket) {
      try {
        const runtime = runtimes.get(socket.data.graphId);
        const handler = runtime?.graph.controllers.get(socket.data.controllerId)?.open;
        const result = handler?.(context(socket));
        if (result instanceof Promise) result.catch(() => fail(socket));
      } catch { fail(socket); }
    },
    message(socket, message) {
      try {
        const runtime = runtimes.get(socket.data.graphId);
        if (runtime === undefined) { fail(socket); return; }
        const result = runtime.dispatch(message, context(socket));
        if (result instanceof Promise) result.catch(() => fail(socket));
      } catch { fail(socket); }
    },
    drain(socket) {
      try {
        const handler = runtimes.get(socket.data.graphId)?.graph.controllers.get(socket.data.controllerId)?.drain;
        const result = handler?.(context(socket));
        if (result instanceof Promise) result.catch(() => fail(socket));
      } catch { fail(socket); }
    },
    close(socket, code, reason) {
      try {
        const handler = runtimes.get(socket.data.graphId)?.graph.controllers.get(socket.data.controllerId)?.close;
        const result = handler?.(context(socket), code, reason);
        if (result instanceof Promise) result.catch(() => {});
      } catch {}
    },
    error(socket, error) {
      try {
        const handler = runtimes.get(socket.data.graphId)?.graph.controllers.get(socket.data.controllerId)?.error;
        const result = handler?.(error, context(socket));
        if (result instanceof Promise) result.catch(() => fail(socket));
      } catch { fail(socket); }
    },
  };
}
