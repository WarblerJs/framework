import type { SocketGuard } from "./guards";
import type { SocketValidatorDefinition } from "./validation";

/** Supported socket lifecycle names. */
export type SocketLifecycle = "open" | "message" | "drain" | "close" | "error";
/** Options compiled for an application event subscription. */
export interface SocketSubscribeOptions<TInput = unknown> {
  readonly guards?: readonly SocketGuard<TInput>[];
  readonly validator?: SocketValidatorDefinition<TInput>;
  readonly rateLimit?: Readonly<{ limit: number; windowMs: number }>;
  readonly binary?: boolean;
  readonly compression?: boolean;
  readonly timeoutMs?: number;
}
/** Immutable decorator record consumed by bootstrap/compiler tooling. */
export type SocketEventMetadata =
  | Readonly<{ kind: "lifecycle"; lifecycle: SocketLifecycle; method: string | symbol }>
  | Readonly<{ kind: "subscribe"; event: string; method: string | symbol; options: SocketSubscribeOptions<unknown> }>;

// `args` is deliberately `any[]`, not `unknown[]` — see the identical note in
// `@warblerjs/http`'s `route.decorator.ts`. Under native (stage-3) decorator checking,
// a rest-parameter type of `unknown[]` makes the target contravariantly incompatible
// with any concretely-typed handler.
type EventHandler = (this: object, ...args: readonly any[]) => unknown;
type StandardEventDecorator = <T extends EventHandler>(handler: T, context: ClassMethodDecoratorContext) => T;
type CompatibleEventDecorator = MethodDecorator & StandardEventDecorator;

const records = new WeakMap<object, readonly SocketEventMetadata[]>();
function add(target: object, record: SocketEventMetadata): void {
  const current = records.get(target) ?? [];
  if (record.kind === "lifecycle" && current.some((item) => item.kind === "lifecycle" && item.lifecycle === record.lifecycle))
    throw new TypeError(`Duplicate @On${record.lifecycle} lifecycle handler`);
  if (record.kind === "subscribe" && current.some((item) => item.kind === "subscribe" && item.event === record.event))
    throw new TypeError(`Duplicate socket subscription: ${record.event}`);
  records.set(target, Object.freeze([...current, Object.freeze(record)]));
}
/**
 * Supports both native (stage-3) `@`-decorator application — where the decorated
 * value is the method itself, keyed individually — and direct legacy-style calls
 * (`OnOpen()(prototype, key, descriptor)`), matching `@warblerjs/http`'s
 * `routeDecorator`'s dual-mode handling of the same native/legacy split.
 */
function lifecycle(name: SocketLifecycle): CompatibleEventDecorator {
  const decorate = (...arguments_: readonly unknown[]): unknown => {
    const first = arguments_[0];
    const second = arguments_[1];
    if (typeof first === "function" && isDecoratorContext(second)) {
      if (second.private || second.static) throw new TypeError(`@On${name.charAt(0).toUpperCase()}${name.slice(1)} must decorate a public instance method`);
      add(first, { kind: "lifecycle", lifecycle: name, method: second.name });
      return first;
    }
    if (typeof first !== "object" || first === null || (typeof second !== "string" && typeof second !== "symbol")) {
      throw new TypeError(`@On${name.charAt(0).toUpperCase()}${name.slice(1)} must decorate a method`);
    }
    add(first, { kind: "lifecycle", lifecycle: name, method: second });
    return undefined;
  };
  return decorate as CompatibleEventDecorator;
}
/** Marks the connection-open handler. */
export function OnOpen(): CompatibleEventDecorator { return lifecycle("open"); }
/** Marks the unknown/general-message handler. */
export function OnMessage(): CompatibleEventDecorator { return lifecycle("message"); }
/** Marks the native backpressure-drain handler. */
export function OnDrain(): CompatibleEventDecorator { return lifecycle("drain"); }
/** Marks the connection-close handler. */
export function OnClose(): CompatibleEventDecorator { return lifecycle("close"); }
/** Marks the socket-error handler. */
export function OnError(): CompatibleEventDecorator { return lifecycle("error"); }
/** Subscribes a method to an application event. */
export function Subscribe<TInput = unknown>(event: string, options: SocketSubscribeOptions<TInput> = {}): CompatibleEventDecorator {
  if (typeof event !== "string" || event.length === 0) throw new TypeError("Socket event must be non-empty");
  const immutable = Object.freeze({ ...options, guards: options.guards === undefined ? undefined : Object.freeze([...options.guards]) });
  const decorate = (...arguments_: readonly unknown[]): unknown => {
    const first = arguments_[0];
    const second = arguments_[1];
    const options_ = immutable as SocketSubscribeOptions<unknown>;
    if (typeof first === "function" && isDecoratorContext(second)) {
      if (second.private || second.static) throw new TypeError("@Subscribe must decorate a public instance method");
      add(first, { kind: "subscribe", event, method: second.name, options: options_ });
      return first;
    }
    if (typeof first !== "object" || first === null || (typeof second !== "string" && typeof second !== "symbol")) {
      throw new TypeError("@Subscribe must decorate a method");
    }
    add(first, { kind: "subscribe", event, method: second, options: options_ });
    return undefined;
  };
  return decorate as CompatibleEventDecorator;
}
/** Reads immutable event metadata during bootstrap/compilation. */
export function getSocketEventMetadata(target: object): readonly SocketEventMetadata[] {
  return records.get(target) ?? Object.freeze([]);
}
function isDecoratorContext(value: unknown): value is ClassMethodDecoratorContext {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "method";
}
