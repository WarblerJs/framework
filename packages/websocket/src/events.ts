import type { SocketGuard } from "./guards";
import type { SocketValidator } from "./validation";

/** Supported socket lifecycle names. */
export type SocketLifecycle = "open" | "message" | "drain" | "close" | "error";
/** Options compiled for an application event subscription. */
export interface SocketSubscribeOptions<TInput = unknown> {
  readonly guards?: readonly SocketGuard<TInput>[];
  readonly validator?: SocketValidator<TInput>;
  readonly rateLimit?: Readonly<{ limit: number; windowMs: number }>;
  readonly binary?: boolean;
  readonly compression?: boolean;
  readonly timeoutMs?: number;
}
/** Immutable decorator record consumed by bootstrap/compiler tooling. */
export type SocketEventMetadata =
  | Readonly<{ kind: "lifecycle"; lifecycle: SocketLifecycle; method: string | symbol }>
  | Readonly<{ kind: "subscribe"; event: string; method: string | symbol; options: SocketSubscribeOptions<unknown> }>;

const records = new WeakMap<object, readonly SocketEventMetadata[]>();
function add(target: object, record: SocketEventMetadata): void {
  const current = records.get(target) ?? [];
  if (record.kind === "lifecycle" && current.some((item) => item.kind === "lifecycle" && item.lifecycle === record.lifecycle))
    throw new TypeError(`Duplicate @On${record.lifecycle} lifecycle handler`);
  if (record.kind === "subscribe" && current.some((item) => item.kind === "subscribe" && item.event === record.event))
    throw new TypeError(`Duplicate socket subscription: ${record.event}`);
  records.set(target, Object.freeze([...current, Object.freeze(record)]));
}
function lifecycle(name: SocketLifecycle): MethodDecorator {
  return (target, method): void => { add(target, { kind: "lifecycle", lifecycle: name, method }); };
}
/** Marks the connection-open handler. */
export function OnOpen(): MethodDecorator { return lifecycle("open"); }
/** Marks the unknown/general-message handler. */
export function OnMessage(): MethodDecorator { return lifecycle("message"); }
/** Marks the native backpressure-drain handler. */
export function OnDrain(): MethodDecorator { return lifecycle("drain"); }
/** Marks the connection-close handler. */
export function OnClose(): MethodDecorator { return lifecycle("close"); }
/** Marks the socket-error handler. */
export function OnError(): MethodDecorator { return lifecycle("error"); }
/** Subscribes a method to an application event. */
export function Subscribe<TInput = unknown>(event: string, options: SocketSubscribeOptions<TInput> = {}): MethodDecorator {
  if (typeof event !== "string" || event.length === 0) throw new TypeError("Socket event must be non-empty");
  const immutable = Object.freeze({ ...options, guards: options.guards === undefined ? undefined : Object.freeze([...options.guards]) });
  return (target, method): void => {
    add(target, { kind: "subscribe", event, method, options: immutable as SocketSubscribeOptions<unknown> });
  };
}
/** Reads immutable event metadata during bootstrap/compilation. */
export function getSocketEventMetadata(target: object): readonly SocketEventMetadata[] {
  return records.get(target) ?? Object.freeze([]);
}
