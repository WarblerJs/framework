import { InvalidTransportError, TransportError } from "../errors";
import { TransportState, type TransportStateValue } from "../state";
import type { MaybePromise } from "../types";
import type { TransportAdapter } from "./transport-adapter";
import type { TransportContext } from "./transport-context";

function isTransportKind(value: unknown): boolean {
  switch (value) {
    case "http":
    case "websocket":
    case "tcp":
    case "udp":
    case "mcp":
    case "webrtc":
      return true;
    default:
      return false;
  }
}

/** Owns one transport adapter instance and enforces its lifecycle state machine. */
export class TransportHandle<TConfig, TNative, TShared = undefined> {
  readonly #adapter: TransportAdapter<TConfig, TNative, TShared>;
  readonly #config: Readonly<TConfig>;
  readonly #context: TransportContext<TShared>;
  #state: TransportStateValue = TransportState.CREATED;
  #native: TNative | undefined;

  /** Creates a handle in the created state. */
  public constructor(
    adapter: TransportAdapter<TConfig, TNative, TShared>,
    config: Readonly<TConfig>,
    context: TransportContext<TShared>,
  ) {
    if (adapter === null || typeof adapter !== "object") {
      throw new InvalidTransportError("Transport adapter must be an object");
    }
    if (!isTransportKind(adapter.kind)) {
      throw new InvalidTransportError("Transport adapter has an invalid kind");
    }
    if (typeof adapter.start !== "function" || typeof adapter.stop !== "function") {
      throw new InvalidTransportError("Transport adapter must implement start and stop", adapter.kind);
    }
    this.#adapter = adapter;
    this.#config = config;
    this.#context = context;
  }

  /** Identifies the transport owned by this handle. */
  public get kind(): TransportAdapter<TConfig, TNative, TShared>["kind"] {
    return this.#adapter.kind;
  }

  /** Returns the handle's current lifecycle state. */
  public get state(): TransportStateValue {
    return this.#state;
  }

  /** Returns the native handle after startup succeeds, otherwise undefined. */
  public get native(): TNative | undefined {
    return this.#native;
  }

  /** Starts the transport synchronously or asynchronously according to the adapter. */
  public start(): MaybePromise<this> {
    if (this.#state !== TransportState.CREATED) {
      throw new InvalidTransportError(
        `Cannot start transport "${this.kind}" from state "${this.#state}"`,
        this.kind,
        this.#state,
      );
    }
    this.#state = TransportState.STARTING;
    let result: MaybePromise<TNative>;
    try {
      result = this.#adapter.start(
        Object.freeze({ config: this.#config, transport: this.#context }),
      );
    } catch (error) {
      this.#state = TransportState.STOPPED;
      throw this.#lifecycleError("start", error);
    }
    if (result instanceof Promise) {
      return result.then(
        (native) => this.#completeStart(native),
        (error: unknown) => {
          this.#state = TransportState.STOPPED;
          throw this.#lifecycleError("start", error);
        },
      );
    }
    return this.#completeStart(result);
  }

  /** Stops a running transport synchronously or asynchronously according to the adapter. */
  public stop(): MaybePromise<void> {
    if (this.#state !== TransportState.RUNNING || this.#native === undefined) {
      throw new InvalidTransportError(
        `Cannot stop transport "${this.kind}" from state "${this.#state}"`,
        this.kind,
        this.#state,
      );
    }
    this.#state = TransportState.STOPPING;
    let result: MaybePromise<void>;
    try {
      result = this.#adapter.stop(
        Object.freeze({ native: this.#native, transport: this.#context }),
      );
    } catch (error) {
      this.#state = TransportState.STOPPED;
      this.#native = undefined;
      throw this.#lifecycleError("stop", error);
    }
    if (result instanceof Promise) {
      return result.then(
        () => this.#completeStop(),
        (error: unknown) => {
          this.#state = TransportState.STOPPED;
          this.#native = undefined;
          throw this.#lifecycleError("stop", error);
        },
      );
    }
    this.#completeStop();
  }

  #completeStart(native: TNative): this {
    if (native === null || native === undefined) {
      this.#state = TransportState.STOPPED;
      throw new InvalidTransportError(
        `Transport "${this.kind}" returned an invalid native handle`,
        this.kind,
        this.#state,
      );
    }
    this.#native = native;
    this.#state = TransportState.RUNNING;
    return this;
  }

  #completeStop(): void {
    this.#native = undefined;
    this.#state = TransportState.STOPPED;
  }

  #lifecycleError(operation: "start" | "stop", error: unknown): TransportError {
    if (error instanceof TransportError) return error;
    return new TransportError(
      `Transport "${this.kind}" failed to ${operation}`,
      this.kind,
      { cause: error },
    );
  }
}
