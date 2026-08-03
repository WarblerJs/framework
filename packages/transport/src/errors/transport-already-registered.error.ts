import type { TransportKindValue } from "../types";
import { TransportError } from "./transport-error";

/** Indicates that an adapter is already registered for a transport kind. */
export class TransportAlreadyRegisteredError extends TransportError {
  /** Creates a duplicate-registration failure. */
  public constructor(kind: TransportKindValue) {
    super(`Transport "${kind}" is already registered`, kind);
    this.name = "TransportAlreadyRegisteredError";
  }
}
