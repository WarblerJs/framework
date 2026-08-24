import { defineHandler, JsonRes } from "@warblerjs/framework";

const message = "orders";

export const index = defineHandler({
  run: () => JsonRes({
    message,
  }),
});
