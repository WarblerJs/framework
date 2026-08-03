import type { HttpNativeServerFactory } from "../native";
import { ServerStateError } from "../errors";
import type { HttpServer, HttpServerOptions } from "./http-server.types";
import { ServerState, type ServerStateValue } from "./server-state";

/** Owns one native Bun server handle without global singleton state. */
export class HttpServerOwner implements HttpServer {
  readonly #options: HttpServerOptions;
  readonly #factory: HttpNativeServerFactory;
  #state: ServerStateValue = ServerState.CREATED;
  #native: Bun.Server<undefined> | undefined;

  /** Creates an unstarted native server owner. */
  public constructor(options: HttpServerOptions, factory: HttpNativeServerFactory) {
    this.#options = options;
    this.#factory = factory;
  }

  /** Returns the current owner state. */
  public get state(): ServerStateValue { return this.#state; }

  /** Starts the native server once; repeated running starts are safe no-ops. */
  public start(): void {
    if (this.#state === ServerState.RUNNING) return;
    if (this.#state !== ServerState.CREATED) throw new ServerStateError(`Cannot start HTTP server from ${this.#state}`);
    this.#native = this.#factory(this.#options);
    this.#state = ServerState.RUNNING;
  }

  /** Stops the native server; repeated stopped calls are safe no-ops. */
  public stop(closeActiveConnections = false): void | Promise<void> {
    if (this.#state === ServerState.STOPPED) return;
    if (this.#state !== ServerState.RUNNING || this.#native === undefined) {
      throw new ServerStateError(`Cannot stop HTTP server from ${this.#state}`);
    }
    this.#state = ServerState.STOPPING;
    const result = this.#native.stop(closeActiveConnections);
    return result.then(
      () => { this.#native = undefined; this.#state = ServerState.STOPPED; },
      (error: unknown) => {
        this.#native = undefined;
        this.#state = ServerState.STOPPED;
        throw new ServerStateError("Native HTTP server failed to stop", { cause: error });
      },
    );
  }
}
