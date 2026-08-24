import { defineHttpGraph } from "@warblerjs/framework";

import * as handlers from "./presentation/http/handlers/home.handlers";

export default defineHttpGraph({
  prefix: "/",

  middlewares: [],

  providers: [],

  routes: {
    "GET /": {
      name: "home.index",
      handler: handlers.index,
    },
  },
});
