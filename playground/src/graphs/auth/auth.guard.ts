import type { Guard } from "@warbler/http";

export const authGuard: Guard = (request, context): boolean => {
  context.set("requestId", crypto.randomUUID());
  return true;
  //return request.headers.get("authorization") === "Bearer playground";
};
