# @warbler/core

Core contracts for Warbler applications: graphs, transports, dependency injection, providers, metadata, and application definition.

## Example

```ts
import { Graph, Service, Repository, Transport, createApp, inject } from "@warbler/core";

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
import { ProviderScope, Service } from "@warbler/core";

@Service()
class UserService {} // visible only in its declaring Graph

@Service({ provide: ProviderScope.ROOT })
class LoggerService {} // visible from every Graph
```

The compiler builds a direct provider map for each Graph and one root map. Dependencies resolve
from the current Graph first and then the root map; providers from unrelated Graphs are never
searched. Instance lifetime remains independently configurable as `scope: "singleton" |
"transient"` on class and factory provider definitions.
