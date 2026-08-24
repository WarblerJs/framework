import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/test.handlers";
import { Provider } from "@warblerjs/framework";
import { FindUserRepositoryPort } from "./domain/ports/user.repository.port";
import { WlbPgFindUserRepository } from "./infrastructure/persistence/wlb-pg-user.repository";

export default defineHttpGraph({
  prefix: "/api",

  middlewares: [],
  providers: [
    Provider({provide: FindUserRepositoryPort ,useExisting: WlbPgFindUserRepository })
  ],
  routes: {
    "GET /test": {
      name: 'test.index',
      handler: handlers.getTest
    },
    "POST /test/:id": {
      handler: handlers.postTest,
      name: "test.create",
    },
    "PUT /test/:id": {
      handler: handlers.postTest,
      name: "test.put",
    },
  },
});