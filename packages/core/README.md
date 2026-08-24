# @warblerjs/core

Core contracts for Warbler applications: graphs, transports, dependency injection, providers, metadata, and application definition.

## Example

```ts
import { Graph, Service, Repository, Transport, createApp, inject } from "@warblerjs/core";

@Repository()
class UserRepository {}

@Service()
class UserService {
  readonly repository = inject(UserRepository);
}

@Graph({
  prefix: "/users",
  providers: [UserService, UserRepository],
})
class UserGraph {}

export default createApp({ graphs: [UserGraph] });
```

## Provider visibility

Injectable providers are Graph-local unless explicitly promoted to the root scope:

```ts
import { ProviderScope, Service } from "@warblerjs/core";

@Service()
class UserService {} // visible only in its declaring Graph

@Service({ provide: ProviderScope.ROOT })
class LoggerService {} // visible from every Graph
```

The compiler builds a direct provider map for each Graph and one root map. Dependencies resolve
from the current Graph first and then the root map; providers from unrelated Graphs are never
searched. Instance lifetime remains independently configurable as `scope: "singleton" |
"transient"` on class and factory provider definitions.

## Errors

`WarblerError` is the transport-agnostic base error for application code — controllers,
services, and repositories throw it (or a convenience subclass) and let it propagate; there is
no need for a `try/catch` in every layer. The nearest transport boundary (`@warblerjs/http`'s
`view()`/route handling, `@warblerjs/websocket`'s socket dispatch, ...) catches it exactly once,
normalizes it, logs it, and renders a response appropriate for that transport:

```ts
import { NotFoundError } from "@warblerjs/core";

class FindUserUseCase {
  async execute(id: string) {
    const user = await this.repository.findById(id);
    if (!user) throw new NotFoundError("USER_NOT_FOUND", "User not found");
    return user;
  }
}
```

```ts
export class WarblerError extends Error {
  constructor(
    code: string,      // stable, machine-readable identifier
    status: number,     // HTTP-equivalent status, used by every transport that has one
    message?: string,
    expose = true,       // false hides `message` behind a generic one in production
    fatal = false,        // marks the failure connection/session-fatal (e.g. closes a WebSocket)
    options?: ErrorOptions, // `cause` is preserved for internal logging, never sent to a client
  );
}
```

Convenience subclasses cover the common HTTP-equivalent statuses without redeclaring them:
`BadRequestError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError`
(404), `ConflictError` (409). `WarblerError` itself remains directly usable for anything else.

`normalizeError(error: unknown): NormalizedWarblerError` turns any thrown value — a
`WarblerError`, a native `Error`, or a non-`Error` thrown value — into one safe shape (`{code,
status, message, expose, fatal, cause}`). `message` is already the safe-to-expose variant
(the real message when `expose` is `true`, a generic "Internal Server Error" otherwise); an
unrecognized error always normalizes to a generic, non-exposed internal error. Transport
packages that recognize their own additional error types (e.g. `@warblerjs/http`'s `HttpError`)
translate those into a `WarblerError` first, then call this — `@warblerjs/core` itself has no
knowledge of any transport.
