import type { TransportStateValue } from "../state";
import type { TransportKindValue } from "../types";
import { TransportError } from "./transport-error";

/** Indicates an invalid adapter definition or lifecycle operation. */
export class InvalidTransportError extends TransportError {
  /** Creates an invalid-transport failure with optional lifecycle state context. */
  public constructor(
    message: string,
    kind?: TransportKindValue,
    public readonly state?: TransportStateValue,
    options?: ErrorOptions,
  ) {
    super(message, kind, options);
    this.name = "InvalidTransportError";
  }
}
