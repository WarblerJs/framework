# Testing

Use `MemoryTransport` from `@warblerjs/email/testing`.

```ts
const transport = new MemoryTransport();
const email = new Email({ transport: "memory" }, renderer, transport);
await email.send({ to: "user@example.test", subject: "Hi", text: "Hi" });
expect(transport.messages).toHaveLength(1);
```
