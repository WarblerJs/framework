# @warblerjs/framework

Canonical public façade for Warbler applications.

Application code should import stable framework contracts from this package:

```ts
import {
  defineHttpGraph,
  defineValidator,
  v,
  Provider,
} from "@warblerjs/framework";

import type {
  AppRequest,
  Guard,
  Middleware,
} from "@warblerjs/framework";
```

The underlying packages remain modular. This package re-exports selected public identities from
`@warblerjs/core`, `@warblerjs/http`, `@warblerjs/validators`, and `@warblerjs/websocket` without wrapping
them or adding request-time work.
