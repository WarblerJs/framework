import { freezeDeep } from "../utils/freeze";
import { validateWebsocketConfig } from "../validator";

/** Validates and deeply freezes WebSocket transport configuration. */
export function normalizeWebsocketConfig<T>(value: T): Readonly<T> {
  validateWebsocketConfig(value);
  return freezeDeep(value);
}
