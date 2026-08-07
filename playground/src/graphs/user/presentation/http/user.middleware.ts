import type { AppRequest, Middleware } from "@warbler/http";

export const userRequestMiddleware: Middleware<AppRequest> = async (request, context, next) => {
  return next(request);
};
