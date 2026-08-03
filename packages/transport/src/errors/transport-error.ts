import type { TransportKindValue } from "../types";

/** Base class for all failures produced by the transport abstraction layer. */
export class TransportError extends Error {
  /** Creates a typed transport failure. */
  public constructor(
    message: string,
    public readonly kind?: TransportKindValue,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TransportError";
  }
}
