import type { TransportKindValue } from "../types";
import { TransportError } from "./transport-error";

/** Indicates that no adapter is registered for a requested transport kind. */
export class TransportNotFoundError extends TransportError {
  /** Creates an unknown-transport failure. */
  public constructor(kind: TransportKindValue) {
    super(`Transport "${kind}" is not registered`, kind);
    this.name = "TransportNotFoundError";
  }
}
