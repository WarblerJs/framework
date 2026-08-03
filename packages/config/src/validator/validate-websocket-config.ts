import { validateWebsocket } from "./transport-validation";

/** Validates WebSocket transport configuration and throws on the first invalid value. */
export function validateWebsocketConfig(value: unknown): void {
  validateWebsocket(value);
}
