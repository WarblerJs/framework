# Overview

`@warblerjs/events` is an in-process, compile-first event system for lightweight side effects.

```ts
export const UserCreated = event((userId: string, email: string) => ({ userId, email } as const));
events.dispatch(UserCreated(user.id, user.email));
```

The compiler discovers exported `event()`, `listen()`, and `interceptEvent()` definitions, assigns
numeric IDs, emits executable imports, and creates the root `EventDispatcher` provider. Runtime does
not scan files, decorators, directories, or event-name strings.

Flow:

```text
POST /users
    -> CreateUserUseCase
    -> DB insert
    -> UserCreated
    -> compiled dispatcher
       -> welcome email
       -> websocket notification
       -> audit write
```
