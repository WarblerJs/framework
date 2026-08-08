import type { ServerWebSocket } from "bun";
import { Console } from "@warbler/console";
import { normalizeError } from "@warbler/core";
import type { SocketContext } from "./context";

/**
 * The unified exception boundary for one WebSocket handler invocation (a subscribed
 * event, or an `open`/`drain`/`close` lifecycle callback). Never throws itself.
 *
 * Normalizes the error, logs it, best-effort dispatches the compiled `"error"` lifecycle
 * (a no-op if the controller has no `@OnError()` — the existing socket-event pipeline
 * already resolves that generically, so nothing new is needed there), then either sends a
 * safe `{event:"error", data:{code,message}}` envelope and keeps the connection open
 * (the default — a single failed action must not kill the connection), or closes it with
 * 1011 when the normalized error is marked `fatal`.
 */
export function handleSocketError<TData>(
  error: unknown,
  socket: ServerWebSocket<TData>,
  context: SocketContext,
  dispatch: (event: string, message: unknown, context: unknown) => unknown,
): void {
  const normalized = normalizeError(error);
  Console.error("WebSocket handler failed.", {
    connectionId: context.connection.id,
    code: normalized.code,
    status: normalized.status,
  });

  try {
    dispatch("error", { code: normalized.code, message: normalized.message }, context);
  } catch {
    // A broken application @OnError() handler must never prevent the safe error
    // envelope below from reaching the client.
  }

  if (normalized.fatal) {
    try {
      socket.close(1011, "Internal WebSocket error");
    } catch {
      // Socket may already be closed/closing — nothing further to do.
    }
    return;
  }

  try {
    context.send({ event: "error", data: { code: normalized.code, message: normalized.message } });
  } catch {
    try {
      socket.close(1011, "Internal WebSocket error");
    } catch {
      // Socket may already be closed/closing — nothing further to do.
    }
  }
}
