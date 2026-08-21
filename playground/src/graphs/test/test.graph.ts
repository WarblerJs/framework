import { defineHttpGraph } from "@warbler/http";

import * as handlers from "./test.handlers";

export default defineHttpGraph({
  prefix: "/api",

  middlewares: [],
  providers: [],

  routes: {
    "GET /test": handlers.getTest,

    "POST /test": {
      handler: handlers.postTest,
      name: "test.create",
    },
  },
});