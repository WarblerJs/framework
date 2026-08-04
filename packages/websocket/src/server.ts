import { WebSocketStateError } from "./errors";
/** WebSocket server lifecycle values. */
export const WebSocketServerState = Object.freeze({ CREATED: "created", STARTING: "starting", RUNNING: "running", STOPPING: "stopping", STOPPED: "stopped" } as const);
/** WebSocket server lifecycle value. */
export type WebSocketServerStateValue = (typeof WebSocketServerState)[keyof typeof WebSocketServerState];
/** Minimal native Bun server ownership contract. */
export interface BunWebSocketServerHandle { stop(closeActiveConnections?: boolean): Promise<void>; readonly pendingWebSockets?: number; publish(topic: string, data: string | ArrayBuffer | Uint8Array, compress?: boolean): number; subscriberCount(topic: string): number }
/** Injectable native server factory. */
export type BunWebSocketServerFactory = () => BunWebSocketServerHandle;
/** Explicit, non-global owner of a dedicated Bun server. */
export class WebSocketServerOwner {
  readonly #factory: BunWebSocketServerFactory;
  #state: WebSocketServerStateValue = WebSocketServerState.CREATED;
  #native: BunWebSocketServerHandle | undefined;
  /** Creates an unstarted owner. */
  public constructor(factory: BunWebSocketServerFactory) { this.#factory = factory; }
  /** Current lifecycle state. */
  public get state(): WebSocketServerStateValue { return this.#state; }
  /** Current native handle while running. */
  public get native(): BunWebSocketServerHandle | undefined { return this.#native; }
  /** Starts exactly once. */
  public start(): BunWebSocketServerHandle {
    if (this.#state !== WebSocketServerState.CREATED) throw new WebSocketStateError(`Cannot start WebSocket server from ${this.#state}`);
    this.#state = WebSocketServerState.STARTING;
    try { this.#native = this.#factory(); this.#state = WebSocketServerState.RUNNING; return this.#native; }
    catch (cause) { this.#state = WebSocketServerState.STOPPED; throw new WebSocketStateError("Failed to start WebSocket server", { cause }); }
  }
  /** Stops safely; repeated stopped calls are no-ops. */
  public stop(closeActiveConnections = false): void | Promise<void> {
    if (this.#state === WebSocketServerState.STOPPED) return;
    if (this.#state !== WebSocketServerState.RUNNING || this.#native === undefined) throw new WebSocketStateError(`Cannot stop WebSocket server from ${this.#state}`);
    this.#state = WebSocketServerState.STOPPING;
    return this.#native.stop(closeActiveConnections).then(() => { this.#native = undefined; this.#state = WebSocketServerState.STOPPED; }, (cause: unknown) => { this.#native = undefined; this.#state = WebSocketServerState.STOPPED; throw new WebSocketStateError("Failed to stop WebSocket server", { cause }); });
  }
}
