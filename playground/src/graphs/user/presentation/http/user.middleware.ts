import type { AppRequest, Middleware } from "@warblerjs/framework";

export const userRequestMiddleware: Middleware<AppRequest> = async (request, context, next) => {
  return next(request);
};
