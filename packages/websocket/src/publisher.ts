import type { SocketSendResult } from "./backpressure";
import { SocketRuntimeNotReadyError, SocketRuntimeStoppedError } from "./errors";
import { internalPublish, type SocketNativePublisher } from "./internal-publish";
import type { SocketMessageFormat, SocketOutgoingMessage } from "./message";

/** Production publish options for application services/controllers. */
export interface SocketPublisherOptions {
  readonly compress?: boolean;
}

/** Live runtime target used by the package-owned publisher facade. */
export interface SocketPublisherRuntimeTarget extends SocketNativePublisher {
  readonly format: SocketMessageFormat;
}

let activeTarget: SocketPublisherRuntimeTarget | undefined;
let runtimeStopped = false;

/**
 * General-purpose WebSocket topic publisher for HTTP controllers, services, jobs, and providers.
 *
 * The publisher intentionally owns no socket registry. Each call resolves the current active runtime
 * target and delegates to the same native publish path used by `SocketContext.publish()`.
 */
export class SocketPublisher {
  /** Publishes one encoded event envelope to a Bun topic. */
  public publish<TData>(
    topic: string,
    message: SocketOutgoingMessage<TData>,
    options?: SocketPublisherOptions,
  ): SocketSendResult {
    const target = currentTarget();
    return internalPublish(target, topic, message, { format: target.format, compress: options?.compress });
  }
}

/** Activates a live WebSocket runtime as the default application publish target. */
export function activateSocketPublisherRuntime(target: SocketPublisherRuntimeTarget): void {
  activeTarget = target;
  runtimeStopped = false;
}

/** Clears the active runtime target when a WebSocket runtime is stopped. */
export function deactivateSocketPublisherRuntime(target?: SocketPublisherRuntimeTarget): void {
  if (target === undefined || activeTarget === target) {
    activeTarget = undefined;
    runtimeStopped = true;
  }
}

/** Resets publisher runtime state for isolated tests. */
export function resetSocketPublisherRuntimeForTests(): void {
  activeTarget = undefined;
  runtimeStopped = false;
}

function currentTarget(): SocketPublisherRuntimeTarget {
  if (activeTarget !== undefined) return activeTarget;
  if (runtimeStopped) throw new SocketRuntimeStoppedError("WebSocket runtime is stopped.");
  throw new SocketRuntimeNotReadyError("WebSocket runtime is not ready.");
}
