import type { SocketContext } from "./context";
import { executeSocketGuards, type SocketGuard } from "./guards";
import { decodeSocketMessage, type SocketMessage, type SocketOutgoingMessage } from "./message";
import type { NormalizedWebSocketConfig } from "./config";
import type { SocketValidator } from "./validation";

/** Compact flags checked by generated event dispatch. */
export const SocketEventFlag = Object.freeze({
  BINARY: 1 << 0, VALIDATION_ENABLED: 1 << 1, GUARDS_ENABLED: 1 << 2,
  COMPRESS_RESPONSE: 1 << 3, RATE_LIMITED: 1 << 4, AUTH_REQUIRED: 1 << 5,
});
/** Compiler-generated event record. */
export interface CompiledSocketEvent {
  readonly eventId: number; readonly event: string; readonly controllerId: number; readonly handlerId: number;
  readonly flags: number; readonly guardStart: number; readonly guardCount: number; readonly validatorId: number; readonly timeoutMs: number;
}
/** Prebound controller handler. */
export type CompiledSocketHandler = (message: SocketMessage<unknown>, context: SocketContext<unknown>) => void | SocketOutgoingMessage<unknown> | Promise<void | SocketOutgoingMessage<unknown>>;
/** Compiler-generated controller record. */
export interface CompiledSocketController {
  readonly controllerId: number; readonly handlers: ReadonlyMap<number, CompiledSocketHandler>;
  readonly open?: (context: SocketContext<unknown>) => void | Promise<void>;
  readonly message?: CompiledSocketHandler;
  readonly drain?: (context: SocketContext<unknown>) => void | Promise<void>;
  readonly close?: (context: SocketContext<unknown>, code: number, reason: string) => void | Promise<void>;
  readonly error?: (error: unknown, context: SocketContext<unknown>) => void | Promise<void>;
}
/** Compiler-generated graph used by upgrade and dispatch. */
export interface CompiledSocketGraph {
  readonly graphId: number; readonly prefix: string; readonly controllerId: number;
  readonly events: readonly CompiledSocketEvent[]; readonly controllers: ReadonlyMap<number, CompiledSocketController>;
  readonly guards?: readonly SocketGuard[]; readonly validators?: readonly SocketValidator[];
}
/** O(1) startup-built event table. */
export type CompiledSocketEventTable = ReadonlyMap<string, CompiledSocketEvent>;
/** Builds the startup event lookup, rejecting duplicate names. */
export function createSocketEventTable(events: readonly CompiledSocketEvent[]): CompiledSocketEventTable {
  const table = new Map<string, CompiledSocketEvent>();
  for (const event of events) { if (table.has(event.event)) throw new TypeError(`Duplicate compiled event: ${event.event}`); table.set(event.event, event); }
  return table;
}
function isThenable<T>(value: T | Promise<T>): value is Promise<T> { return typeof value === "object" && value !== null && typeof (value as Promise<T>).then === "function"; }
/** Creates a dispatcher with a synchronous fast path and precomputed lookup. */
export function createSocketDispatcher(graph: CompiledSocketGraph, config: NormalizedWebSocketConfig) {
  const table = createSocketEventTable(graph.events);
  const controller = graph.controllers.get(graph.controllerId);
  if (controller === undefined) throw new TypeError("Compiled socket controller is missing");
  return (raw: string | ArrayBuffer | Uint8Array, context: SocketContext<unknown>): void | Promise<void> => {
    const message = decodeSocketMessage(raw, { format: config.messages.format, maxEventNameLength: config.messages.maxEventNameLength, maxMessageIdLength: config.messages.maxMessageIdLength });
    const event = table.get(message.event);
    if (event === undefined) {
      if (controller.message !== undefined) return finish(controller.message(message, context), context, false);
      if (config.messages.unknownEvent === "send-error") context.send({ id: message.id, event: "socket.error", data: null, error: { code: "UNSUPPORTED_EVENT", message: "Unsupported event." } });
      else if (config.messages.unknownEvent === "close") context.close(1008, "Unsupported event");
      return;
    }
    const handler = controller.handlers.get(event.handlerId);
    if (handler === undefined) throw new TypeError("Compiled socket handler is missing");
    const run = (): void | Promise<void> => {
      const validator = graph.validators?.[event.validatorId];
      if ((event.flags & SocketEventFlag.VALIDATION_ENABLED) !== 0 && validator !== undefined) {
        const result = validator(message.data, message, context);
        if (result !== true && typeof result === "object" && result !== null && "valid" in result && result.valid === false) {
          context.send({ id: message.id, event: "socket.error", data: null, error: { code: "VALIDATION_FAILED", message: "Message validation failed." } }); return;
        }
      }
      return finish(handler(message, context), context, (event.flags & SocketEventFlag.COMPRESS_RESPONSE) !== 0);
    };
    const guards = graph.guards?.slice(event.guardStart, event.guardStart + event.guardCount) ?? [];
    if ((event.flags & SocketEventFlag.GUARDS_ENABLED) === 0 || guards.length === 0) return run();
    const allowed = executeSocketGuards(guards, { message, context });
    if (isThenable(allowed)) return allowed.then((ok) => { if (ok) return run(); context.send({ id: message.id, event: "socket.error", data: null, error: { code: "FORBIDDEN", message: "Event rejected." } }); });
    if (allowed) return run();
    context.send({ id: message.id, event: "socket.error", data: null, error: { code: "FORBIDDEN", message: "Event rejected." } });
  };
}
function finish(result: void | SocketOutgoingMessage<unknown> | Promise<void | SocketOutgoingMessage<unknown>>, context: SocketContext<unknown>, compress: boolean): void | Promise<void> {
  if (isThenable(result)) return result.then((outgoing) => { if (outgoing !== undefined) context.send(outgoing, { compress }); });
  if (result !== undefined) context.send(result, { compress });
}
