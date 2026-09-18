import { JsonRes } from "@warblerjs/framework";

const message = "orders";

export const index = () => JsonRes({
  message,
});
