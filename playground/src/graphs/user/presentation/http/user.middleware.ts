import type { AppRequest } from "@warbler/http";

export async function userRequestMiddleware(
  context: AppRequest,
  next: () => Promise<Response>,
): Promise<Response> {
  return next();
}
