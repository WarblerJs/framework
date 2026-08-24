import { redirectTo, type Guard } from "@warblerjs/framework";

export const guestGuard: Guard = (_request, context) => context.get("auth") === undefined
  ? true
  : redirectTo("home");

export const authGuard: Guard = (_request, context) => context.get("auth") === undefined
  ? redirectTo("login")
  : true;
