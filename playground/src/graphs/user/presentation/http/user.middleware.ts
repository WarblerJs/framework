import type { AppRequest, Middleware } from "@warbler/framework";

export const userRequestMiddleware: Middleware<AppRequest> = async (request, context, next) => {
  return next(request);
};
