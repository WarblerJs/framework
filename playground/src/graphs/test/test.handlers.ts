import { defineHandler } from "@warbler/core";
import {
  JsonRes,
  type AppRequest,
} from "@warbler/http";

import { testValidator } from "./test.validator";

export const getTest = defineHandler({
  run: (_ctx: AppRequest) => {
    return JsonRes({
      success: true,
      method: "GET",
    });
  },
});

export const postTest = defineHandler({
  validator: testValidator,

  guards: [],
  middlewares: [],

  run: (ctx: AppRequest) => {
    return JsonRes({
      success: true,
      method: "POST",
      body: ctx.body,
    });
  },
});
