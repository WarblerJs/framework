# Dispatcher

```ts
const events = inject(EventDispatcher);
events.dispatch(UserCreated(user.id, user.email));
await events.dispatchAndWait(UserCreated(user.id, user.email));
```

`dispatch()` runs synchronous listeners inline in compiled order. Async listeners are invoked
immediately and receive one rejection handler routed to the event error boundary. The caller does not
await them.

`dispatchAndWait()` runs synchronous listeners inline, starts async listeners together in compiled
order, then waits for all of them to settle. If anything fails it rejects with `EventDispatchError`.

`events.drain({ timeoutMs })` stops accepting new dispatches, waits for in-flight fire-and-forget
listeners up to the timeout, and returns still-pending event/listener IDs.
