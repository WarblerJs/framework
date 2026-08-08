

import type { Guard } from "@warbler/http";

export const userPermissionGuard: Guard = (request, context): boolean => {
  context.set<`${string}-${string}-${string}-${string}-${string}`>("requestId", crypto.randomUUID());
  return true;
  //return request.headers.get("authorization") === "Bearer playground";
};