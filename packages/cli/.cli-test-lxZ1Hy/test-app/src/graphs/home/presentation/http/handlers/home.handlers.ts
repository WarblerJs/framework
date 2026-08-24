import { defineHandler, JsonRes } from "@warblerjs/framework";

const message = "Warbler";

export const index = defineHandler({
  run: () => JsonRes({ message }),
});
