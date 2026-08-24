import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/orders.handlers";

export default defineHttpGraph({
  prefix: "/orders",

  middlewares: [],

  providers: [],

  routes: {
    "GET /": {
      name: "orders.index",
      handler: handlers.index,
    },
  },
});
