import { JsonRes } from "@warblerjs/framework";

const message = "customers";

export const index = () => JsonRes({
  message,
});
