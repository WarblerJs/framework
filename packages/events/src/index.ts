import { Console } from "@warblerjs/console";

const EVENT_ID = Symbol.for("@warblerjs/events.eventId");

/** Payload object produced by a Warbler event factory. */
export type EventPayload<TFactory> = TFactory extends (...args: never[]) => infer TPayload ? TPayload extends object ? TPayload : never : never;

/** Runtime marker shared by every Warbler event factory. */
export interface EventFactoryMarker {
  readonly __warblerEvent: true;
}

/** A statically analyzable Warbler event factory. */
export interface EventFactory<TArgs extends readonly unknown[] = readonly unknown[], TPayload extends object = object> extends EventFactoryMarker {
  (...args: TArgs): TPayload;
}

/** A listener produced by `listen()`. */
export interface EventListenerDefinition<TPayload extends object = object> {
  readonly __warblerListener: true;
  readonly event: EventFactoryMarker;
  handle(event: TPayload): unknown;
}

/** Context supplied to event interceptors. */
export interface EventContext<TEvent = unknown> {
  readonly eventId: number;
  readonly event: TEvent;
  readonly dispatchedAt: number;
  readonly log: typeof Console;
  readonly requestId?: string;
  readonly traceId?: string;
}

/** One interceptor wrapping the complete listener batch for a dispatch. */
export type EventInterceptor = (context: EventContext, next: () => void | Promise<void>) => void | Promise<void>;

/** Definition produced by `interceptEvent()`. */
export interface EventInterceptorDefinition {
  readonly __warblerEventInterceptor: true;
  readonly handle: EventInterceptor;
}

/** Generated event binding consumed by `EventDispatcher`. */
export interface EventBinding {
  readonly id: number;
  readonly event: EventFactoryMarker;
  readonly debugName?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

/** Generated listener binding consumed by `EventDispatcher`. */
export interface EventListenerBinding {
  readonly id: number;
  readonly eventId: number;
  readonly listener: EventListenerDefinition;
}

/** Generated interceptor binding consumed by `EventDispatcher`. */
export interface EventInterceptorBinding {
  readonly id: number;
  readonly interceptor: EventInterceptorDefinition;
}

/** Generated immutable event runtime tables. */
export interface EventRuntimeBindings {
  readonly events: readonly EventBinding[];
  readonly listeners: readonly EventListenerBinding[];
  readonly eventListeners: readonly (readonly number[])[];
  readonly interceptors: readonly EventInterceptorBinding[];
}

/** Dispatcher construction options supplied by generated provider bindings. */
export interface EventDispatcherOptions {
  readonly development?: boolean;
  readonly run?: <T>(callback: () => T) => T;
  readonly shutdownTimeoutMs?: number;
  readonly onError?: (failure: EventFailure) => void;
}

/** One listener/interceptor failure captured by event dispatch. */
export interface EventFailure {
  readonly eventId: number;
  readonly listenerId: number;
  readonly cause: unknown;
}

/** Raised by `dispatchAndWait()` when one or more listeners/interceptors fail. */
export class EventDispatchError extends Error {
  public readonly eventId: number;
  public readonly failures: ReadonlyArray<Readonly<{ readonly listenerId: number; readonly cause: unknown }>>;

  /** Creates one aggregate error for a failed dispatch. */
  public constructor(eventId: number, failures: ReadonlyArray<Readonly<{ readonly listenerId: number; readonly cause: unknown }>>) {
    super(`Event dispatch ${eventId} failed with ${failures.length} failure(s).`);
    this.name = "EventDispatchError";
    this.eventId = eventId;
    this.failures = Object.freeze([...failures]);
  }
}

/** Raised when dispatching after dispatcher shutdown begins. */
export class EventDispatcherShutdownError extends Error {
  public constructor() {
    super("Event dispatcher is shutting down.");
    this.name = "EventDispatcherShutdownError";
  }
}

/** Result returned by `EventDispatcher.drain()`. */
export interface EventDrainResult {
  readonly pending: ReadonlyArray<Readonly<{ readonly eventId: number; readonly listenerId: number }>>;
}

/** Options accepted by `EventDispatcher.fake()`. */
export interface EventFakeOptions {
  readonly passthrough?: boolean;
}

/** One event captured by a fake dispatcher. */
export interface FakeDispatchedEvent<TPayload extends object = object> {
  readonly eventId: number;
  readonly event: TPayload;
}

/** Test fake handle returned by `EventDispatcher.fake()`. */
export interface EventDispatcherFake {
  readonly events: readonly FakeDispatchedEvent[];
  restore(): void;
  dispatched<TFactory extends EventFactoryMarker>(factory: TFactory): readonly EventPayload<TFactory>[];
  expectDispatched<TFactory extends EventFactoryMarker>(factory: TFactory): void;
  expectNotDispatched<TFactory extends EventFactoryMarker>(factory: TFactory): void;
}

/** Defines a typed event factory. */
export function event<TArgs extends readonly unknown[], TPayload extends object>(
  factory: (...args: TArgs) => TPayload,
): EventFactory<TArgs, TPayload> {
  const create = ((...args: TArgs): TPayload => {
    const payload = factory(...args);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Warbler events must return a plain object payload.");
    Object.defineProperty(payload, EVENT_ID, { configurable: false, enumerable: false, value: eventId(create), writable: false });
    return payload;
  }) as EventFactory<TArgs, TPayload>;
  Object.defineProperty(create, "__warblerEvent", { enumerable: false, value: true });
  Object.defineProperty(create, EVENT_ID, { configurable: true, enumerable: false, value: -1, writable: true });
  return create;
}

/** Defines a typed listener for one event factory. */
export function listen<TArgs extends readonly unknown[], TPayload extends object>(
  eventFactory: EventFactory<TArgs, TPayload>,
  handle: (event: TPayload) => unknown,
): EventListenerDefinition<TPayload> {
  return Object.freeze({ __warblerListener: true, event: eventFactory, handle });
}

/** Defines a whole-dispatch event interceptor. */
export function interceptEvent(handle: EventInterceptor): EventInterceptorDefinition {
  return Object.freeze({ __warblerEventInterceptor: true, handle });
}

/** Compiled in-process event dispatcher. */
export class EventDispatcher {
  readonly #bindings: EventRuntimeBindings;
  readonly #development: boolean;
  readonly #run: <T>(callback: () => T) => T;
  readonly #shutdownTimeoutMs: number;
  readonly #onError: (failure: EventFailure) => void;
  readonly #inFlight = new Set<Readonly<{ readonly eventId: number; readonly listenerId: number; readonly promise: Promise<unknown> }>>();
  #shuttingDown = false;
  #fake: MutableEventFake | undefined;

  /** Creates a dispatcher from compiler-generated bindings. */
  public constructor(bindings: EventRuntimeBindings = emptyBindings, options: EventDispatcherOptions = {}) {
    this.#bindings = freezeBindings(bindings);
    this.#development = options.development ?? false;
    this.#run = options.run ?? ((callback) => callback());
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1_000;
    this.#onError = options.onError ?? defaultErrorBoundary;
    for (const binding of this.#bindings.events) bindEventId(binding.event, binding.id);
  }

  /** Dispatches without waiting for asynchronous listeners. Synchronous listeners run inline. */
  public dispatch<TEvent extends object>(event: TEvent): void {
    this.#assertOpen();
    const eventId = getEventId(event);
    if (this.#captureFake(eventId, event) === "suppressed") return;
    this.#prepare(event);
    const context = this.#context(eventId, event);
    try {
      const result = this.#run(() => this.#withInterceptors(context, () => this.#runListenersFireAndForget(eventId, event)));
      if (isThenable(result)) this.#track(eventId, -1, result.catch((cause: unknown) => this.#onError({ eventId, listenerId: -1, cause })));
    } catch (cause) {
      this.#onError({ eventId, listenerId: -1, cause });
    }
  }

  /** Dispatches and resolves only after every listener/interceptor has settled. */
  public async dispatchAndWait<TEvent extends object>(event: TEvent): Promise<void> {
    this.#assertOpen();
    const eventId = getEventId(event);
    if (this.#captureFake(eventId, event) === "suppressed") return;
    this.#prepare(event);
    const context = this.#context(eventId, event);
    const failures: EventFailure[] = [];
    try {
      await this.#run(() => this.#withInterceptors(context, () => this.#runListenersAndWait(eventId, event, failures)));
    } catch (cause) {
      failures.push(Object.freeze({ eventId, listenerId: -1, cause }));
    }
    if (failures.length > 0) throw new EventDispatchError(eventId, failures);
  }

  /** Starts test fake mode. Real listeners are suppressed unless `passthrough` is true. */
  public fake(options: EventFakeOptions = {}): EventDispatcherFake {
    const prior = this.#fake;
    const state: MutableEventFake = { passthrough: options.passthrough === true, events: [] };
    this.#fake = state;
    return Object.freeze({
      get events(): readonly FakeDispatchedEvent[] { return Object.freeze([...state.events]); },
      restore: (): void => { if (this.#fake === state) this.#fake = prior; },
      dispatched: <TFactory extends EventFactoryMarker>(factory: TFactory): readonly EventPayload<TFactory>[] =>
        Object.freeze(state.events.filter((item) => item.eventId === eventId(factory)).map((item) => item.event as EventPayload<TFactory>)),
      expectDispatched: <TFactory extends EventFactoryMarker>(factory: TFactory): void => {
        if (!state.events.some((item) => item.eventId === eventId(factory))) throw new Error(`Expected event ${eventId(factory)} to be dispatched.`);
      },
      expectNotDispatched: <TFactory extends EventFactoryMarker>(factory: TFactory): void => {
        if (state.events.some((item) => item.eventId === eventId(factory))) throw new Error(`Expected event ${eventId(factory)} not to be dispatched.`);
      },
    });
  }

  /** Stops accepting dispatches and waits for in-flight fire-and-forget listeners up to a timeout. */
  public async drain(options: { readonly timeoutMs?: number } = {}): Promise<EventDrainResult> {
    this.#shuttingDown = true;
    const timeoutMs = options.timeoutMs ?? this.#shutdownTimeoutMs;
    if (this.#inFlight.size === 0) return Object.freeze({ pending: Object.freeze([]) });
    await Promise.race([
      Promise.allSettled([...this.#inFlight].map((item) => item.promise)),
      Bun.sleep(timeoutMs),
    ]);
    return Object.freeze({
      pending: Object.freeze([...this.#inFlight].map((item) => Object.freeze({ eventId: item.eventId, listenerId: item.listenerId }))),
    });
  }

  #assertOpen(): void {
    if (this.#shuttingDown) throw new EventDispatcherShutdownError();
  }

  #captureFake<TEvent extends object>(eventId: number, event: TEvent): "passthrough" | "suppressed" | "none" {
    const fake = this.#fake;
    if (fake === undefined) return "none";
    fake.events.push(Object.freeze({ eventId, event }));
    return fake.passthrough ? "passthrough" : "suppressed";
  }

  #prepare<TEvent extends object>(event: TEvent): void {
    if (this.#development && !Object.isFrozen(event)) Object.freeze(event);
  }

  #context<TEvent extends object>(eventId: number, event: TEvent): EventContext<TEvent> {
    return Object.freeze({ eventId, event, dispatchedAt: performance.now(), log: Console });
  }

  #withInterceptors(context: EventContext, runListeners: () => void | Promise<void>, index = 0): void | Promise<void> {
    const binding = this.#bindings.interceptors[index];
    if (binding === undefined) return runListeners();
    return binding.interceptor.handle(context, () => this.#withInterceptors(context, runListeners, index + 1));
  }

  #runListenersFireAndForget<TEvent extends object>(eventId: number, event: TEvent): void {
    const listenerIds = this.#bindings.eventListeners[eventId] ?? emptyListenerIds;
    for (const listenerId of listenerIds) {
      const binding = this.#bindings.listeners[listenerId];
      if (binding === undefined) continue;
      try {
        const result = this.#run(() => binding.listener.handle(event));
        if (isThenable(result)) this.#track(eventId, listenerId, result.catch((cause: unknown) => this.#onError({ eventId, listenerId, cause })));
      } catch (cause) {
        this.#onError({ eventId, listenerId, cause });
      }
    }
  }

  async #runListenersAndWait<TEvent extends object>(eventId: number, event: TEvent, failures: EventFailure[]): Promise<void> {
    const listenerIds = this.#bindings.eventListeners[eventId] ?? emptyListenerIds;
    const pending: Array<Promise<Readonly<{ readonly listenerId: number; readonly status: "fulfilled" | "rejected"; readonly cause?: unknown }>>> = [];
    for (const listenerId of listenerIds) {
      const binding = this.#bindings.listeners[listenerId];
      if (binding === undefined) continue;
      try {
        const result = this.#run(() => binding.listener.handle(event));
        if (isThenable(result)) {
          pending.push(result.then(
            () => Object.freeze({ listenerId, status: "fulfilled" as const }),
            (cause: unknown) => Object.freeze({ listenerId, status: "rejected" as const, cause }),
          ));
        }
      } catch (cause) {
        failures.push(Object.freeze({ eventId, listenerId, cause }));
      }
    }
    if (pending.length === 0) return;
    const settled = await Promise.all(pending);
    for (const item of settled) if (item.status === "rejected") failures.push(Object.freeze({ eventId, listenerId: item.listenerId, cause: item.cause }));
  }

  #track(eventId: number, listenerId: number, promise: Promise<unknown>): void {
    const entry = Object.freeze({ eventId, listenerId, promise });
    this.#inFlight.add(entry);
    promise.finally(() => this.#inFlight.delete(entry)).catch(() => {});
  }
}

interface MutableEventFake {
  readonly passthrough: boolean;
  readonly events: FakeDispatchedEvent[];
}

const emptyListenerIds: readonly number[] = Object.freeze([]);
const emptyBindings: EventRuntimeBindings = Object.freeze({
  events: Object.freeze([]),
  listeners: Object.freeze([]),
  eventListeners: Object.freeze([]),
  interceptors: Object.freeze([]),
});

function freezeBindings(bindings: EventRuntimeBindings): EventRuntimeBindings {
  return Object.freeze({
    events: Object.freeze([...bindings.events]),
    listeners: Object.freeze([...bindings.listeners]),
    eventListeners: Object.freeze(bindings.eventListeners.map((listeners) => Object.freeze([...listeners]))),
    interceptors: Object.freeze([...bindings.interceptors]),
  });
}

function bindEventId(factory: EventFactoryMarker, id: number): void {
  Object.defineProperty(factory, EVENT_ID, { configurable: true, enumerable: false, value: id, writable: true });
}

function eventId(factory: EventFactoryMarker): number {
  return Reflect.get(factory, EVENT_ID) as number;
}

function getEventId(event: object): number {
  const id = Reflect.get(event, EVENT_ID);
  if (typeof id !== "number" || id < 0) throw new TypeError("Unknown event payload. Dispatch values produced by event(...).");
  return id;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function defaultErrorBoundary(failure: EventFailure): void {
  Console.error("Event listener failed.", { eventId: failure.eventId, listenerId: failure.listenerId });
}
