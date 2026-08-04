/** Interpreted result of Bun's native send/publish return value. */
export type SocketSendResult = Readonly<{ status: "sent"; bytes: number }> | Readonly<{ status: "backpressure" }> | Readonly<{ status: "dropped" }>;
/** Interprets Bun's native send result without hiding backpressure. */
export function interpretSendResult(result: number): SocketSendResult {
  if (result < 0) return { status: "backpressure" };
  if (result === 0) return { status: "dropped" };
  return { status: "sent", bytes: result };
}
