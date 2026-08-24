import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/customers.handlers";

export default defineHttpGraph({
  prefix: "/customers",

  middlewares: [],

  providers: [],

  routes: {
    "GET /": {
      name: "customers.index",
      handler: handlers.index,
    },
  },
});
