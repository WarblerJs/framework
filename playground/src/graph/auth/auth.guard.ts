import type { Guard } from "@warbler/core";

export const loginGuard: Guard = async (context) => {
  return context.user !== undefined;
};
