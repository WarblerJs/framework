# Interceptors

Interceptors wrap the whole listener batch once per dispatch.

```ts
export const eventTelemetry = interceptEvent(async (context, next) => {
  const start = performance.now();
  await next();
  context.log.debug("event", { eventId: context.eventId, duration: performance.now() - start });
});
```

For v1, `next()` means "run all compiled listeners for this event." Per-listener interception is a
separate future capability, not the default.
