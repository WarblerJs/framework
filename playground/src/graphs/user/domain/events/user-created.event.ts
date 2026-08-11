import { event } from "@warbler/events";

export const UserCreated = event(
    (userId: string, email: string) => ({ userId, email } as const)
);
