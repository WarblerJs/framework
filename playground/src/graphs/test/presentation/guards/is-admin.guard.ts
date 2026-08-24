import { redirectTo, type Guard } from "@warbler/framework";


// export const guestGuard: Guard = (_request, context) => context.get("auth") === undefined
//   ? true
//   : redirectTo("home");

export const guestGuardTest: Guard = (_request, context) => {
    context.set('testId','22');
    return true;
};