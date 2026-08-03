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
