# Events

An event is a fact that already happened.

```ts
export const UserCreated = event((userId: string, email: string) => ({ userId, email } as const));
```

Payloads should be small plain objects. Do not put `Request`, `Response`, socket contexts, database
clients, service instances, passwords, hashes, tokens, or other secrets in event payloads.

Development dispatch freezes the payload before listeners receive it. Production dispatch skips that
freeze.
