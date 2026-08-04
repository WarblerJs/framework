import type { Guard } from "@warbler/core";

export const authGuard: Guard = (input): boolean => {
  return true;
  //return input instanceof Request && input.headers.get("authorization") === "Bearer playground";
};
