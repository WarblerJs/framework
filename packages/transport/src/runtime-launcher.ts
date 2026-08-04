/** Graceful shutdown controls shared by Runtime and transport launchers. */
export interface RuntimeTransportStopOptions {
  readonly closeActiveConnections?: boolean;
  readonly reason?: string;
  readonly timeoutMs?: number;
}
/** Runtime services exposed to transport launchers without mutable ownership tables. */
export interface RuntimeExecutionContext {
  resolveProvider(graphId: number, providerId: number): unknown;
  invokeHandler(handlerId: number, input: readonly unknown[]): unknown;
}
/** Input passed once to an enabled transport launcher. */
export interface RuntimeTransportStartInput<TBindings = unknown, TConfig = unknown> {
  readonly bindings: TBindings;
  readonly config: TConfig;
  readonly runtime: RuntimeExecutionContext;
  readonly signal: AbortSignal;
}
/** Lazy transport integration boundary shared without a Runtime package dependency. */
export interface RuntimeTransportLauncher<TBindings = unknown, TConfig = unknown, THandle = unknown> {
  readonly kind: string;
  start(input: RuntimeTransportStartInput<TBindings, TConfig>): THandle | Promise<THandle>;
  stop?(handle: THandle, options: RuntimeTransportStopOptions): void | Promise<void>;
}
