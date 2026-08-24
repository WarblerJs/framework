# @warblerjs/events

Compile-first functional events for Warbler.

```ts
import { event, listen, EventDispatcher } from "@warblerjs/events";
import { inject } from "@warblerjs/core";

export const UserCreated = event((userId: string, email: string) => ({ userId, email } as const));

export const auditUserCreated = listen(UserCreated, async (event) => {
  console.log(event.userId, event.email);
});

const events = inject(EventDispatcher);
events.dispatch(UserCreated(user.id, user.email));
```

`dispatch()` runs synchronous listeners inline and starts async listeners without awaiting them.
`dispatchAndWait()` starts async listeners together and rejects with `EventDispatchError` containing
all listener failures.

Detailed docs live in `docs/`.
