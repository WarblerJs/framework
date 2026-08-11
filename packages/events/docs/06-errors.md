# Errors

`dispatch()` catches synchronous throws and async rejections and sends them to the central boundary.
It must not create unhandled promise rejections.

`dispatchAndWait()` rejects once with:

```ts
export class EventDispatchError extends Error {
  readonly eventId: number;
  readonly failures: ReadonlyArray<{ listenerId: number; cause: unknown }>;
}
```

Payloads are never logged automatically.
