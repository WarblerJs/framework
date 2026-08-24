

import type { Guard } from "@warbler/framework";

export const userPermissionGuard: Guard = (request, context): boolean => {
  if (typeof context.get("requestId") === "string") context.set("permission", "granted");
  return true;
  //return request.headers.get("authorization") === "Bearer playground";
};
