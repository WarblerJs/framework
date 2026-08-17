import { redirectTo, type Guard } from "@warbler/http";

export const guestGuard: Guard = (_request, context) => context.get("auth") === undefined
  ? true
  : redirectTo("home");

export const authGuard: Guard = (_request, context) => context.get("auth") === undefined
  ? redirectTo("login")
  : true;
