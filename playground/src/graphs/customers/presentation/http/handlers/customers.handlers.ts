import { defineHandler, JsonRes } from "@warblerjs/framework";

const message = "customers";

export const index = defineHandler({
  run: () => JsonRes({
    message,
  }),
});
