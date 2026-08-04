import type { SocketContext } from "./context";
import type { SocketMessage } from "./message";
/** Functional guard input. */
export interface SocketGuardInput<TData = unknown, TUser = unknown> {
  readonly message: SocketMessage<TData>; readonly context: SocketContext<TUser>;
}
/** Functional socket guard. */
export type SocketGuard<TData = unknown, TUser = unknown> =
  (input: SocketGuardInput<TData, TUser>) => boolean | Promise<boolean>;
function thenable(value: boolean | Promise<boolean>): value is Promise<boolean> {
  return typeof value === "object" && value !== null && typeof value.then === "function";
}
/** Runs guards in order, preserving a fully synchronous path. */
export function executeSocketGuards<TData, TUser>(
  guards: readonly SocketGuard<TData, TUser>[], input: SocketGuardInput<TData, TUser>,
): boolean | Promise<boolean> {
  for (let index = 0; index < guards.length; index++) {
    const result = guards[index]!(input);
    if (thenable(result)) return continueAsync(result, guards, input, index + 1);
    if (!result) return false;
  }
  return true;
}
async function continueAsync<TData, TUser>(first: Promise<boolean>, guards: readonly SocketGuard<TData, TUser>[], input: SocketGuardInput<TData, TUser>, start: number): Promise<boolean> {
  if (!await first) return false;
  for (let index = start; index < guards.length; index++) if (!await guards[index]!(input)) return false;
  return true;
}
