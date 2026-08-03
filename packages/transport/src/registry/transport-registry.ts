import {
  InvalidTransportError,
  TransportAlreadyRegisteredError,
  TransportNotFoundError,
} from "../errors";
import { TransportKind, type TransportKindValue } from "../types";

function isTransportKind(value: unknown): value is TransportKindValue {
  switch (value) {
    case TransportKind.HTTP:
    case TransportKind.WEBSOCKET:
    case TransportKind.TCP:
    case TransportKind.UDP:
    case TransportKind.MCP:
    case TransportKind.WEBRTC:
      return true;
    default:
      return false;
  }
}

/** Minimal adapter identity retained by the registry. */
export interface TransportRegistration {
  /** Identifies the registered transport. */
  readonly kind: TransportKindValue;
}

/** Stores transport registrations with constant-time lookup and duplicate protection. */
export class TransportRegistry<TRegistration extends TransportRegistration = TransportRegistration> {
  readonly #registrations = new Map<TransportKindValue, TRegistration>();

  /** Returns the number of registered transport adapters. */
  public get size(): number {
    return this.#registrations.size;
  }

  /** Registers one adapter and rejects an existing transport kind. */
  public register(registration: TRegistration): this {
    if (registration === null || typeof registration !== "object") {
      throw new InvalidTransportError("Transport registration must be an object");
    }
    if (!isTransportKind(registration.kind)) {
      throw new InvalidTransportError("Transport registration has an invalid kind");
    }
    if (this.#registrations.has(registration.kind)) {
      throw new TransportAlreadyRegisteredError(registration.kind);
    }
    this.#registrations.set(registration.kind, registration);
    return this;
  }

  /** Returns whether an adapter is registered for a transport kind. */
  public has(kind: TransportKindValue): boolean {
    return this.#registrations.has(kind);
  }

  /** Returns a registered adapter or throws a typed not-found error. */
  public get(kind: TransportKindValue): TRegistration {
    const registration = this.#registrations.get(kind);
    if (registration === undefined) throw new TransportNotFoundError(kind);
    return registration;
  }
}
