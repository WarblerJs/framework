import type { Middleware } from "@warbler/framework";

export interface Tenant {
  readonly id: string;
  readonly source: "header" | "default";
}

export interface User {
  readonly id: string;
  readonly role: "admin";
}

export const requestIdMiddleware: Middleware = (_request, context, next) => {
  context.set<`${string}-${string}-${string}-${string}-${string}`>("requestId", crypto.randomUUID());
  return next();
};

export const tenantMiddleware: Middleware = (request, context, next) => {
  const tenantId = (request.headers as { readonly "x-tenant-id"?: string })["x-tenant-id"];
  context.set<Tenant>("tenant", Object.freeze({
    id: tenantId ?? "playground",
    source: tenantId === undefined ? "default" : "header",
  }));
  return next();
};

export const authMiddleware: Middleware = (_request, context, next) => {
  context.set<User>("user", Object.freeze({ id: "playground-user", role: "admin" }));
  return next();
};

export const auditMiddleware: Middleware = (_request, context, next) => {
  context.set("audit", Object.freeze({ route: "users.middleware.all" }));
  return next();
};
