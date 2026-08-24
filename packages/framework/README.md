# @warbler/framework

Canonical public façade for Warbler applications.

Application code should import stable framework contracts from this package:

```ts
import {
  defineHttpGraph,
  defineHandler,
  defineValidator,
  v,
  Provider,
} from "@warbler/framework";

import type {
  AppRequest,
  Guard,
  Middleware,
} from "@warbler/framework";
```

The underlying packages remain modular. This package re-exports selected public identities from
`@warbler/core`, `@warbler/http`, `@warbler/validators`, and `@warbler/websocket` without wrapping
them or adding request-time work.
