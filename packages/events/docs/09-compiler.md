# Compiler

Warbler uses Policy A for numeric event IDs: IDs are stable across builds as long as the event graph
does not change. Events are ordered by module path plus export name, not discovery order.

The compiler emits:

- `events.generated.ts` with executable imports and runtime bindings
- `events.manifest.json` with `id -> symbol -> source location`

Conceptual internal tables:

```ts
EVENTS = [UserCreated, UserUpdated];
LISTENERS = [sendWelcomeEmail, notifyUserCreated];
EVENT_LISTENERS = [[0, 1]];
```

The representation can change after benchmarks, but runtime source scanning and string lookup are not
part of the hot path.

Definite unconditional cycles are compiler errors. Conditional cycles are warnings. Runtime recursion
protection remains the final boundary for dynamic cycles.
