import type { SocketContext } from "./context";
import type { SocketMessage } from "./message";
/** Validator result with safe application errors. */
export type SocketValidationResult = true | Readonly<{ valid: false; errors?: readonly string[] }>;
/** Precompiled socket data validator. */
export type SocketValidator<TData = unknown> =
  (data: unknown, message: SocketMessage<unknown>, context: SocketContext<unknown>) => TData | SocketValidationResult;
/** Invokes a precompiled validator once. */
export function validateSocketMessage<TData>(validator: SocketValidator<TData>, message: SocketMessage<unknown>, context: SocketContext<unknown>): TData | SocketValidationResult {
  return validator(message.data, message, context);
}
