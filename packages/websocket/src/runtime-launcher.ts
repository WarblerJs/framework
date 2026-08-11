import type { RuntimeTransportLauncher, RuntimeTransportStartInput, RuntimeTransportStopOptions } from "@warbler/transport";
import { Console, createCorrelationId } from "@warbler/console";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { normalizeWebSocketConfig, type WebSocketConfig } from "./config";
import { createSocketContext, type SocketContext } from "./context";
import { decodeSocketMessage } from "./message";
import { activateSocketPublisherRuntime, deactivateSocketPublisherRuntime, type SocketPublisherRuntimeTarget } from "./publisher";
import { handleSocketError } from "./socket-error-boundary";
import { validateOrigin, validateSubprotocol } from "./upgrade";

interface RuntimeSocketData { readonly connectionId: string; readonly connectedAt: number }
interface WebSocketRuntimeBindings {
  readonly compiled?: Readonly<{ readonly events?: Readonly<Record<string, unknown>> }>;
  readonly dispatch: (event: string, message: unknown, context: unknown) => unknown;
}
interface WebSocketRuntimeHandle { readonly server: Bun.Server<RuntimeSocketData>; readonly publisher: SocketPublisherRuntimeTarget }

/** Creates the package-owned dedicated WebSocket Runtime launcher. */
export function createWebSocketRuntimeLauncher(): RuntimeTransportLauncher<WebSocketRuntimeBindings, WebSocketConfig, WebSocketRuntimeHandle> {
  return Object.freeze({
    kind: "websocket",
    start(input: RuntimeTransportStartInput<WebSocketRuntimeBindings, WebSocketConfig>) {
      const config = normalizeWebSocketConfig(input.config);
      const value = input.config as Readonly<Record<string, unknown>>;
      const port = value.port;
      const hostname = typeof value.host === "string" ? value.host : undefined;
      if (config.mode !== "dedicated") throw new TypeError("Independent Runtime WebSocket launcher requires dedicated mode.");
      if (typeof port !== "number" || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new TypeError("Dedicated WebSocket Runtime port is invalid.");
      const handler: WebSocketHandler<RuntimeSocketData> = {
        idleTimeout: config.timeouts.idleSeconds,
        maxPayloadLength: config.messages.maxPayloadLength,
        backpressureLimit: config.backpressure.limitBytes,
        closeOnBackpressureLimit: config.backpressure.closeOnLimit,
        sendPings: config.bun.sendPings,
        publishToSelf: config.bun.publishToSelf,
        perMessageDeflate: config.compression.enabled,
        open(socket) {
          Console.socket({ action: "connect", path: "/chat", connectionId: socket.data.connectionId });
          dispatchLifecycle(input.bindings, "open", undefined, socketContext(socket, config.messages.format, config.limits.subscriptionsPerConnection), socket);
        },
        message(socket, raw) {
          const context = socketContext(socket, config.messages.format, config.limits.subscriptionsPerConnection);
          let message: ReturnType<typeof decodeSocketMessage>;
          try {
            message = decodeSocketMessage(raw, {
              format: config.messages.format,
              maxEventNameLength: config.messages.maxEventNameLength,
              maxMessageIdLength: config.messages.maxMessageIdLength,
            });
          } catch {
            // Malformed wire format — unrelated to application logic, can't even tell
            // which event was intended. Stays connection-fatal, unlike a handler throw.
            socket.close(1008, "Invalid WebSocket message");
            return;
          }
          const known = input.bindings.compiled?.events?.[message.event] !== undefined;
          Console.socket({ action: "incoming", event: message.event, connectionId: socket.data.connectionId, size: rawSize(raw) });
          try {
            const result = input.bindings.dispatch(known ? message.event : "message", message, context);
            settle(result, socket, context, input.bindings);
          } catch (error) {
            handleSocketError(error, socket, context, input.bindings.dispatch);
          }
        },
        drain(socket) {
          dispatchLifecycle(input.bindings, "drain", undefined, socketContext(socket, config.messages.format, config.limits.subscriptionsPerConnection), socket);
        },
        close(socket, code, reason) {
          Console.socket({
            action: "disconnect",
            connectionId: socket.data.connectionId,
            duration: performance.now() - socket.data.connectedAt,
          });
          dispatchLifecycle(input.bindings, "close", Object.freeze({ code, reason }), socketContext(socket, config.messages.format, config.limits.subscriptionsPerConnection), socket);
        },
      };
      const server = Bun.serve<RuntimeSocketData>({
        port,
        ...(hostname === undefined ? {} : { hostname }),
        fetch(request, native) {
          if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Upgrade Required", { status: 426 });
          let protocol: string | undefined;
          try {
            validateOrigin(request, config.origins);
            protocol = validateSubprotocol(request, config.protocols);
          } catch {
            return new Response("WebSocket upgrade rejected", { status: 403 });
          }
          const upgraded = native.upgrade(request, {
            data: Object.freeze({ connectionId: createCorrelationId("conn"), connectedAt: performance.now() }),
            ...(protocol === undefined ? {} : { headers: { "sec-websocket-protocol": protocol } }),
          });
          return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
        },
        websocket: handler,
      });
      const publisher = Object.freeze({
        format: config.messages.format,
        publish(topic: string, data: string | ArrayBuffer | Uint8Array, compress?: boolean): number {
          return server.publish(topic, data, compress);
        },
      });
      activateSocketPublisherRuntime(publisher);
      return Object.freeze({ server, publisher });
    },
    stop(handle: WebSocketRuntimeHandle, options: RuntimeTransportStopOptions) {
      try {
        return handle.server.stop(options.closeActiveConnections ?? false);
      } finally {
        deactivateSocketPublisherRuntime(handle.publisher);
      }
    },
  });
}
function rawSize(value: string | ArrayBuffer | Uint8Array): number {
  return typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
}
function socketContext(socket: ServerWebSocket<RuntimeSocketData>, format: "json" | "text" | "binary", subscriptionLimit: number): SocketContext {
  return createSocketContext(socket, { id: socket.data.connectionId, connectedAt: socket.data.connectedAt }, { format, subscriptionLimit });
}
function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
function settle(value: unknown, socket: ServerWebSocket<RuntimeSocketData>, context: SocketContext, bindings: WebSocketRuntimeBindings): void {
  if (isThenable(value)) value.catch((error: unknown) => handleSocketError(error, socket, context, bindings.dispatch));
}
function dispatchLifecycle(
  bindings: WebSocketRuntimeBindings,
  lifecycle: "open" | "drain" | "close",
  message: unknown,
  context: SocketContext,
  socket: ServerWebSocket<RuntimeSocketData>,
): void {
  try {
    settle(bindings.dispatch(lifecycle, message, context), socket, context, bindings);
  } catch (error) {
    handleSocketError(error, socket, context, bindings.dispatch);
  }
}
