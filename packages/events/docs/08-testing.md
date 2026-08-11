# Testing

```ts
const fake = events.fake();
await useCase.execute(input);
fake.expectDispatched(UserCreated);
fake.restore();
```

Fakes suppress real listeners by default. This keeps unit tests from sending email, publishing
sockets, or touching external systems. Use `events.fake({ passthrough: true })` only when a test
intentionally wants the real listeners to run too.

Suppressed `dispatchAndWait()` resolves immediately.
