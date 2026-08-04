import type { Guard } from "@warbler/core";

export const authGuard: Guard = (input): boolean => {
  return input instanceof Request && input.headers.get("authorization") === "Bearer playground";
};
