import { describe, expect, test } from "bun:test";
import {
  EventDispatchError,
  EventDispatcher,
  EventDispatcherShutdownError,
  event,
  interceptEvent,
  listen,
  type EventRuntimeBindings,
} from "../src";

const UserCreated = event((userId: string, email: string) => ({ userId, email } as const));

function bindings(extra: Partial<EventRuntimeBindings> = {}): EventRuntimeBindings {
  return Object.freeze({
    events: Object.freeze([Object.freeze({ id: 0, event: UserCreated })]),
    listeners: Object.freeze([]),
    eventListeners: Object.freeze([Object.freeze([])]),
    interceptors: Object.freeze([]),
    ...extra,
  });
}

describe("EventDispatcher", () => {
  test("dispatches zero, one, and multiple synchronous listeners in compiled order", () => {
    const calls: string[] = [];
    const first = listen(UserCreated, (event) => calls.push(`first:${event.userId}`));
    const second = listen(UserCreated, (event) => calls.push(`second:${event.email}`));
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([
        Object.freeze({ id: 0, eventId: 0, listener: first }),
        Object.freeze({ id: 1, eventId: 0, listener: second }),
      ]),
      eventListeners: Object.freeze([Object.freeze([0, 1])]),
    }));

    dispatcher.dispatch(UserCreated("1", "a@test"));
    expect(calls).toEqual(["first:1", "second:a@test"]);

    const empty = new EventDispatcher(bindings());
    expect(() => empty.dispatch(UserCreated("2", "b@test"))).not.toThrow();
  });

  test("dispatch captures async listener rejections without unhandled rejections", async () => {
    const failures: unknown[] = [];
    const broken = listen(UserCreated, async () => { throw new Error("boom"); });
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([Object.freeze({ id: 0, eventId: 0, listener: broken })]),
      eventListeners: Object.freeze([Object.freeze([0])]),
    }), { onError: (failure) => failures.push(failure) });

    dispatcher.dispatch(UserCreated("1", "a@test"));
    await Bun.sleep(1);
    expect(failures).toHaveLength(1);
  });

  test("dispatchAndWait starts async listeners together and aggregates failures", async () => {
    const calls: string[] = [];
    const slow = listen(UserCreated, async () => {
      await Bun.sleep(20);
      calls.push("slow");
      throw new Error("slow failed");
    });
    const fast = listen(UserCreated, async () => {
      await Bun.sleep(1);
      calls.push("fast");
      throw new Error("fast failed");
    });
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([
        Object.freeze({ id: 0, eventId: 0, listener: slow }),
        Object.freeze({ id: 1, eventId: 0, listener: fast }),
      ]),
      eventListeners: Object.freeze([Object.freeze([0, 1])]),
    }));

    await expect(dispatcher.dispatchAndWait(UserCreated("1", "a@test"))).rejects.toBeInstanceOf(EventDispatchError);
    expect(calls).toEqual(["fast", "slow"]);
    try {
      await dispatcher.dispatchAndWait(UserCreated("1", "a@test"));
    } catch (error) {
      expect((error as EventDispatchError).failures.map((failure) => failure.listenerId)).toEqual([0, 1]);
    }
  });

  test("freezes payloads in development before listeners run", () => {
    const mutating = listen(UserCreated, (payload) => {
      (payload as { userId: string }).userId = "changed";
    });
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([Object.freeze({ id: 0, eventId: 0, listener: mutating })]),
      eventListeners: Object.freeze([Object.freeze([0])]),
    }), { development: true, onError: () => {} });
    dispatcher.dispatch(UserCreated("1", "a@test"));
  });

  test("interceptors wrap the whole listener batch once", async () => {
    const calls: string[] = [];
    const interceptor = interceptEvent(async (context, next) => {
      calls.push(`before:${context.eventId}`);
      await next();
      calls.push("after");
    });
    const first = listen(UserCreated, () => calls.push("first"));
    const second = listen(UserCreated, () => calls.push("second"));
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([
        Object.freeze({ id: 0, eventId: 0, listener: first }),
        Object.freeze({ id: 1, eventId: 0, listener: second }),
      ]),
      eventListeners: Object.freeze([Object.freeze([0, 1])]),
      interceptors: Object.freeze([Object.freeze({ id: 0, interceptor })]),
    }));

    await dispatcher.dispatchAndWait(UserCreated("1", "a@test"));
    expect(calls).toEqual(["before:0", "first", "second", "after"]);
  });

  test("fake suppresses real listeners by default and can passthrough", async () => {
    let calls = 0;
    const listener = listen(UserCreated, () => { calls++; });
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([Object.freeze({ id: 0, eventId: 0, listener })]),
      eventListeners: Object.freeze([Object.freeze([0])]),
    }));

    const fake = dispatcher.fake();
    await dispatcher.dispatchAndWait(UserCreated("1", "a@test"));
    fake.expectDispatched(UserCreated);
    expect(calls).toBe(0);
    fake.restore();

    const passthrough = dispatcher.fake({ passthrough: true });
    dispatcher.dispatch(UserCreated("2", "b@test"));
    passthrough.expectDispatched(UserCreated);
    expect(calls).toBe(1);
    passthrough.restore();
  });

  test("drain stops new dispatches and reports pending fire-and-forget listeners", async () => {
    const listener = listen(UserCreated, async () => { await Bun.sleep(50); });
    const dispatcher = new EventDispatcher(bindings({
      listeners: Object.freeze([Object.freeze({ id: 0, eventId: 0, listener })]),
      eventListeners: Object.freeze([Object.freeze([0])]),
    }));
    dispatcher.dispatch(UserCreated("1", "a@test"));
    const drained = await dispatcher.drain({ timeoutMs: 1 });
    expect(drained.pending).toEqual([Object.freeze({ eventId: 0, listenerId: 0 })]);
    expect(() => dispatcher.dispatch(UserCreated("2", "b@test"))).toThrow(EventDispatcherShutdownError);
  });
});
