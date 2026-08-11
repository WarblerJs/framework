# Listeners

Listeners are exported functional definitions.

```ts
export const auditUserCreated = listen(UserCreated, async (event) => {
  await audit.insert({ action: "user.created", entityId: event.userId });
});
```

Listeners are for side effects. Keep critical transactional writes in the original transaction and
dispatch only after commit. For durable work, enqueue a job or write an outbox record from a listener.
